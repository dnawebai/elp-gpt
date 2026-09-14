import { NextResponse } from 'next/server';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import { verifyPrincipalStepUpToken } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';
import { getStandingAuthorityState, saveStandingAuthorityPolicy, setStandingAuthorityKillSwitch } from '@/lib/standing-authority';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function requirePasskey(context: NonNullable<Awaited<ReturnType<typeof requireZeroTrustAuthority>>>, body: Record<string, unknown> | null) {
  const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
  if (!passkeys.length) return false;
  const step = verifyPrincipalStepUpToken(typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined);
  if (!step || step.method !== 'passkey' || step.purpose !== 'authority-management' || step.profileId !== context.profileId || step.principalId !== context.principal.id) return false;
  if (!context.session) return step.sessionId === 'owner' && step.tokenVersion === 'owner';
  const live = await validatePrincipalSession({ profileId: context.profileId, principalId: context.principal.id, sessionId: context.session.id, tokenVersion: context.session.tokenVersion });
  return Boolean(live && step.sessionId === live.id && step.tokenVersion === live.tokenVersion);
}

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'manage_authority');
  if (!context) return NextResponse.json({ error: 'Authority-management permission is required.' }, { status: 403 });
  return NextResponse.json(await getStandingAuthorityState(context.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'manage_authority');
  if (!context) return NextResponse.json({ error: 'Authority-management permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!(await requirePasskey(context, body))) return NextResponse.json({ error: 'A fresh passkey verification is required to change standing authority.', stepUpRequired: true, stepUpMethod: 'passkey' }, { status: 428 });
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'save-policy') {
      const policy = await saveStandingAuthorityPolicy(context.profileId, context.principal.id, {
        id: typeof body?.id === 'string' ? body.id : undefined,
        name: typeof body?.name === 'string' ? body.name : '',
        principalId: typeof body?.principalId === 'string' ? body.principalId : context.principal.id,
        allowedToolSlugs: Array.isArray(body?.allowedToolSlugs) ? body.allowedToolSlugs.filter((x): x is string => typeof x === 'string') : [],
        allowedConnectedAccountIds: Array.isArray(body?.allowedConnectedAccountIds) ? body.allowedConnectedAccountIds.filter((x): x is string => typeof x === 'string') : [],
        maxRisk: body?.maxRisk === 'high' ? 'high' : 'write', allowHighRisk: body?.allowHighRisk === true,
        maxActionsPerDay: Number(body?.maxActionsPerDay || 25), maxAmount: body?.maxAmount === undefined ? undefined : Number(body.maxAmount),
        currency: typeof body?.currency === 'string' ? body.currency : undefined,
        recipientDomains: Array.isArray(body?.recipientDomains) ? body.recipientDomains.filter((x): x is string => typeof x === 'string') : [],
        expiresAt: typeof body?.expiresAt === 'string' ? body.expiresAt : undefined,
        enabled: body?.enabled !== false,
      });
      await recordSecurityEventSafe(context.profileId, { category: 'authority', action: 'standing_authority.policy_saved', outcome: 'success', severity: policy.allowHighRisk ? 'critical' : 'high', actorPrincipalId: context.principal.id, subjectId: policy.id, detail: `${policy.name}; ${policy.allowedToolSlugs.join(',')}` });
      return NextResponse.json({ ok: true, policy, state: await getStandingAuthorityState(context.profileId) }, { status: 201 });
    }
    if (action === 'kill-switch') {
      const enabled = body?.enabled !== false;
      const result = await setStandingAuthorityKillSwitch(context.profileId, context.principal.id, enabled);
      await recordSecurityEventSafe(context.profileId, { category: 'authority', action: 'standing_authority.kill_switch', outcome: 'success', severity: enabled ? 'critical' : 'high', actorPrincipalId: context.principal.id, detail: enabled ? 'Standing authority disabled globally.' : 'Standing authority re-enabled.' });
      return NextResponse.json({ ok: true, ...result, state: await getStandingAuthorityState(context.profileId) });
    }
    return NextResponse.json({ error: 'Unsupported standing-authority action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Standing authority update failed.' }, { status: 400 }); }
}
