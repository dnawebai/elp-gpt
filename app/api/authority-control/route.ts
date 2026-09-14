import { NextResponse } from 'next/server';
import { hasCapability, isPrincipalRole } from '@/lib/authority-policy';
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
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function manager(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return null;
  return hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities) ? context : null;
}

async function requireAuthorityStepUp(context: NonNullable<Awaited<ReturnType<typeof manager>>>, body: Record<string, unknown> | null) {
  if (!context.delegated) return true;
  if (!context.session) return false;
  const stepUp = verifyPrincipalStepUpToken(typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined);
  if (!stepUp || stepUp.purpose !== 'authority-management') return false;
  const live = await validatePrincipalSession({ profileId: context.profileId, principalId: context.principal.id, sessionId: context.session.id, tokenVersion: context.session.tokenVersion });
  return Boolean(live && stepUp.profileId === context.profileId && stepUp.principalId === context.principal.id && stepUp.sessionId === live.id && stepUp.tokenVersion === live.tokenVersion);
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
  if (!(await requireAuthorityStepUp(context, body))) return NextResponse.json({ error: 'Fresh delegated step-up authorization is required for authority changes.' }, { status: 428 });
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
      return NextResponse.json({ ok: true, principal, snapshot: await snapshot(context.profileId) }, { status: 201 });
    }
    if (action === 'revoke-principal') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      await revokePrincipal(context.profileId, context.principal.id, principalId);
      await revokeAllPrincipalSessions(context.profileId, principalId, context.principal.id);
      return NextResponse.json({ ok: true, snapshot: await snapshot(context.profileId) });
    }
    if (action === 'create-access') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      const access = await createPrincipalAccess(context.profileId, context.principal.id, principalId);
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
      return NextResponse.json({ ok: true, enrollment }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'revoke-device') {
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
      if (!deviceId) return NextResponse.json({ error: 'deviceId is required.' }, { status: 400 });
      await revokeCompanionDevice(context.profileId, context.principal.id, deviceId);
      return NextResponse.json({ ok: true, snapshot: await snapshot(context.profileId) });
    }
    return NextResponse.json({ error: 'Unsupported authority action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Authority action failed.' }, { status: 400 });
  }
}
