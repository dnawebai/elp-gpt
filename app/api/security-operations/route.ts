import { NextResponse } from 'next/server';
import { hasCapability } from '@/lib/authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import {
  assessSecurityOperations,
  emergencySecurityLockdown,
  resolveSecurityIncident,
  revokeOneSecuritySession,
  revokePrincipalSecuritySessions,
} from '@/lib/security-operations';
import { verifyPrincipalStepUpToken } from '@/lib/security';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function manager(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return null;
  return hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities) ? context : null;
}

async function requireSecurityStepUp(context: NonNullable<Awaited<ReturnType<typeof manager>>>, body: Record<string, unknown> | null) {
  const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
  if (!context.delegated && !passkeys.length) return true;
  const stepUp = verifyPrincipalStepUpToken(typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined);
  if (!stepUp || stepUp.purpose !== 'authority-management' || stepUp.profileId !== context.profileId || stepUp.principalId !== context.principal.id) return false;
  if (passkeys.length && stepUp.method !== 'passkey') return false;
  if (!context.delegated) return stepUp.sessionId === 'owner' && stepUp.tokenVersion === 'owner';
  if (!context.session) return false;
  const live = await validatePrincipalSession({
    profileId: context.profileId,
    principalId: context.principal.id,
    sessionId: context.session.id,
    tokenVersion: context.session.tokenVersion,
  });
  return Boolean(live && stepUp.sessionId === live.id && stepUp.tokenVersion === live.tokenVersion);
}

function stepUpResponse(hasPasskey: boolean) {
  return NextResponse.json({
    error: hasPasskey ? 'A fresh passkey verification is required for this security response action.' : 'Fresh delegated step-up authorization is required for this security response action.',
    stepUpRequired: true,
    stepUpMethod: hasPasskey ? 'passkey' : 'access-grant',
  }, { status: 428, headers: { 'Cache-Control': 'no-store, private' } });
}

export async function GET(request: Request) {
  const context = await manager(request);
  if (!context) return NextResponse.json({ error: 'Security operations require authority-management permission.' }, { status: 403 });
  const snapshot = await assessSecurityOperations(context.profileId, { persistIncidents: false, notify: false });
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await manager(request);
  if (!context) return NextResponse.json({ error: 'Security operations require authority-management permission.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'scan') {
    const snapshot = await assessSecurityOperations(context.profileId, { persistIncidents: true, notify: true });
    return NextResponse.json({ ok: true, snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
  }

  if (!['revoke-session','revoke-principal-sessions','lockdown','resolve-incident'].includes(action)) {
    return NextResponse.json({ error: 'Unsupported security operation.' }, { status: 400 });
  }

  if (!(await requireSecurityStepUp(context, body))) {
    const hasPasskey = (await listActivePasskeys(context.profileId, context.principal.id)).length > 0;
    return stepUpResponse(hasPasskey);
  }

  try {
    if (action === 'revoke-session') {
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
      await revokeOneSecuritySession(context.profileId, sessionId, context.principal.id);
    } else if (action === 'revoke-principal-sessions') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId.trim() : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      await revokePrincipalSecuritySessions(context.profileId, principalId, context.principal.id);
    } else if (action === 'lockdown') {
      const result = await emergencySecurityLockdown(context.profileId, context.principal.id, body?.includeDevices === true);
      const snapshot = await assessSecurityOperations(context.profileId, { persistIncidents: true, notify: true });
      return NextResponse.json({ ok: true, result, snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
    } else if (action === 'resolve-incident') {
      const incidentId = typeof body?.incidentId === 'string' ? body.incidentId.trim() : '';
      if (!incidentId) return NextResponse.json({ error: 'incidentId is required.' }, { status: 400 });
      await resolveSecurityIncident(context.profileId, incidentId, context.principal.id);
    }
    const snapshot = await assessSecurityOperations(context.profileId, { persistIncidents: false, notify: false });
    return NextResponse.json({ ok: true, snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Security response action failed.' }, { status: 400, headers: { 'Cache-Control': 'no-store, private' } });
  }
}
