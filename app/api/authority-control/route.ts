import { NextResponse } from 'next/server';
import { hasCapability, isPrincipalRole } from '@/lib/authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import {
  authoritySnapshot,
  createCompanionEnrollment,
  createPrincipal,
  createPrincipalAccess,
  revokeCompanionDevice,
  revokePrincipal,
} from '@/lib/principal-authority';
import { listPrincipalSessions, revokeAllPrincipalSessions, validatePrincipalSession } from '@/lib/principal-sessions';
import { verifyPrincipalStepUpToken } from '@/lib/security';
import { recordSecurityEventSafe, securityClientFingerprint } from '@/lib/security-audit';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function manager(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return null;
  return hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities) ? context : null;
}

async function requireAuthorityStepUp(context: NonNullable<Awaited<ReturnType<typeof manager>>>, body: Record<string, unknown> | null) {
  const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
  if (!context.delegated && !passkeys.length) return true;
  const stepUp = verifyPrincipalStepUpToken(typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined);
  if (!stepUp || stepUp.purpose !== 'authority-management' || stepUp.profileId !== context.profileId || stepUp.principalId !== context.principal.id) return false;
  if (passkeys.length && stepUp.method !== 'passkey') return false;
  if (!context.delegated) return stepUp.sessionId === 'owner' && stepUp.tokenVersion === 'owner';
  if (!context.session) return false;
  const live = await validatePrincipalSession({ profileId: context.profileId, principalId: context.principal.id, sessionId: context.session.id, tokenVersion: context.session.tokenVersion });
  return Boolean(live && stepUp.sessionId === live.id && stepUp.tokenVersion === live.tokenVersion);
}

async function snapshot(profileId: string) {
  const [authority, sessions] = await Promise.all([authoritySnapshot(profileId), listPrincipalSessions(profileId, 500)]);
  return { ...authority, sessions: sessions.map((item) => ({ ...item, tokenVersion: undefined })) };
}

export async function GET(request: Request) {
  const context = await manager(request);
  if (!context) return NextResponse.json({ error: 'Authority management permission is required.' }, { status: 403 });
  return NextResponse.json(await snapshot(context.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await manager(request);
  if (!context) return NextResponse.json({ error: 'Authority management permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const fingerprint = securityClientFingerprint(request);
  if (!(await requireAuthorityStepUp(context, body))) {
    const hasPasskey = (await listActivePasskeys(context.profileId, context.principal.id)).length > 0;
    await recordSecurityEventSafe(context.profileId, {
      category: 'authority', action: 'authority.step_up_required', outcome: 'info', severity: 'normal',
      actorPrincipalId: context.principal.id, sessionId: context.session?.id,
      detail: action || 'unknown authority change', clientFingerprint: fingerprint,
    });
    return NextResponse.json({ error: hasPasskey ? 'A fresh passkey verification is required for authority changes.' : 'Fresh delegated step-up authorization is required for authority changes.', stepUpRequired: true, stepUpMethod: hasPasskey ? 'passkey' : 'access-grant' }, { status: 428 });
  }
  try {
    if (action === 'create-principal') {
      const role = body?.role;
      if (!isPrincipalRole(role)) return NextResponse.json({ error: 'Invalid principal role.' }, { status: 400 });
      const principal = await createPrincipal({
        profileId: context.profileId,
        actorPrincipalId: context.principal.id,
        displayName: typeof body?.displayName === 'string' ? body.displayName : '',
        role,
        capabilities: Array.isArray(body?.capabilities) ? body.capabilities.filter((x): x is string => typeof x === 'string') : undefined,
      });
      await recordSecurityEventSafe(context.profileId, {
        category: 'authority', action: 'principal.created', outcome: 'success', severity: 'high',
        actorPrincipalId: context.principal.id, subjectId: principal.id, sessionId: context.session?.id,
        detail: principal.role, clientFingerprint: fingerprint,
      });
      return NextResponse.json({ ok: true, principal, snapshot: await snapshot(context.profileId) }, { status: 201 });
    }
    if (action === 'revoke-principal') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      await revokePrincipal(context.profileId, context.principal.id, principalId);
      const revokedSessions = await revokeAllPrincipalSessions(context.profileId, principalId, context.principal.id);
      await recordSecurityEventSafe(context.profileId, {
        category: 'authority', action: 'principal.revoked', outcome: 'success', severity: 'critical',
        actorPrincipalId: context.principal.id, subjectId: principalId, sessionId: context.session?.id,
        detail: `${revokedSessions.length} delegated session${revokedSessions.length === 1 ? '' : 's'} revoked.`, clientFingerprint: fingerprint,
      });
      return NextResponse.json({ ok: true, snapshot: await snapshot(context.profileId) });
    }
    if (action === 'create-access') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      const access = await createPrincipalAccess(context.profileId, context.principal.id, principalId);
      await recordSecurityEventSafe(context.profileId, {
        category: 'authority', action: 'principal.access_issued', outcome: 'success', severity: 'high',
        actorPrincipalId: context.principal.id, subjectId: principalId, sessionId: context.session?.id, clientFingerprint: fingerprint,
      });
      return NextResponse.json({ ok: true, access }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'create-enrollment') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      const enrollment = await createCompanionEnrollment({
        profileId: context.profileId,
        actorPrincipalId: context.principal.id,
        principalId,
        label: typeof body?.label === 'string' ? body.label : '',
        allowedCommands: Array.isArray(body?.allowedCommands) ? body.allowedCommands.filter((x): x is string => typeof x === 'string') : undefined,
      });
      await recordSecurityEventSafe(context.profileId, {
        category: 'authority', action: 'companion.enrollment_issued', outcome: 'success', severity: 'high',
        actorPrincipalId: context.principal.id, subjectId: enrollment.enrollmentId, sessionId: context.session?.id,
        detail: principalId, clientFingerprint: fingerprint,
      });
      return NextResponse.json({ ok: true, enrollment }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'revoke-device') {
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
      if (!deviceId) return NextResponse.json({ error: 'deviceId is required.' }, { status: 400 });
      await revokeCompanionDevice(context.profileId, context.principal.id, deviceId);
      await recordSecurityEventSafe(context.profileId, {
        category: 'authority', action: 'companion.revoked', outcome: 'success', severity: 'high',
        actorPrincipalId: context.principal.id, subjectId: deviceId, sessionId: context.session?.id, clientFingerprint: fingerprint,
      });
      return NextResponse.json({ ok: true, snapshot: await snapshot(context.profileId) });
    }
    return NextResponse.json({ error: 'Unsupported authority action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authority action failed.';
    await recordSecurityEventSafe(context.profileId, {
      category: 'authority', action: 'authority.change_failed', outcome: 'failure', severity: 'high',
      actorPrincipalId: context.principal.id, sessionId: context.session?.id,
      detail: `${action || 'unknown'}: ${message}`.slice(0, 700), clientFingerprint: fingerprint,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
