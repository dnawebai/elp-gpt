import { NextResponse } from 'next/server';
import { hasCapability } from '@/lib/authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { getPrincipal } from '@/lib/principal-authority';
import {
  consumePrincipalAccessNonce,
  createPrincipalSession,
  listPrincipalSessions,
  revokePrincipalSession,
  validatePrincipalSession,
} from '@/lib/principal-sessions';
import {
  AUTHORITY_COOKIE,
  PROFILE_COOKIE,
  createPrincipalSessionToken,
  createPrincipalStepUpToken,
  verifyPrincipalAccessToken,
  verifyProfileToken,
} from '@/lib/security';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

type StepUpPurpose = 'high-risk-approval' | 'authority-management';

function cookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function clientDescriptor(request: Request) {
  return [request.headers.get('user-agent') || '', request.headers.get('sec-ch-ua-platform') || ''].join('|').slice(0, 800);
}

function setAuthorityCookie(response: NextResponse, token: string, maxAge = 60 * 60 * 12) {
  response.cookies.set(AUTHORITY_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge });
  return response;
}

export async function GET(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });
  const all = hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities);
  const sessions = (await listPrincipalSessions(context.profileId, 500))
    .filter((item) => all || item.principalId === context.principal.id)
    .map((item) => ({ ...item, tokenVersion: undefined }));
  const passkeyCount = (await listActivePasskeys(context.profileId, context.principal.id)).length;
  return NextResponse.json({ principal: context.principal, delegated: context.delegated, currentSessionId: context.session?.id || null, sessions, passkeyCount }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';

  if (action === 'exchange-access') {
    const profile = verifyProfileToken(cookie(request, PROFILE_COOKIE));
    const access = verifyPrincipalAccessToken(typeof body?.accessToken === 'string' ? body.accessToken : undefined);
    if (!profile || !access || access.profileId !== profile.profileId) return NextResponse.json({ error: 'Invalid or expired principal access grant.' }, { status: 401 });
    const principal = await getPrincipal(profile.profileId, access.principalId);
    if (!principal || principal.status !== 'active') return NextResponse.json({ error: 'Principal is not active.' }, { status: 403 });
    const consumed = await consumePrincipalAccessNonce(profile.profileId, principal.id, access.nonce);
    if (!consumed) return NextResponse.json({ error: 'Principal access grant has already been used.' }, { status: 409 });
    const session = await createPrincipalSession({ profileId: profile.profileId, principalId: principal.id, assurance: 'standard', ttlSeconds: 60 * 60 * 12, clientDescriptor: clientDescriptor(request) });
    const token = createPrincipalSessionToken(profile.profileId, principal.id, { sessionId: session.id, tokenVersion: session.tokenVersion, assurance: session.assurance, ttlSeconds: 60 * 60 * 12 });
    const response = NextResponse.json({ ok: true, principal, session: { ...session, tokenVersion: undefined } }, { headers: { 'Cache-Control': 'no-store, private' } });
    return setAuthorityCookie(response, token);
  }

  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });

  if (action === 'step-up') {
    if (!context.delegated || !context.session) return NextResponse.json({ error: 'Access-grant step-up is only required for delegated principal sessions.' }, { status: 400 });
    const purposeRaw = typeof body?.purpose === 'string' ? body.purpose : 'high-risk-approval';
    if (!['high-risk-approval','authority-management'].includes(purposeRaw)) return NextResponse.json({ error: 'Invalid step-up purpose.' }, { status: 400 });
    const purpose = purposeRaw as StepUpPurpose;
    if (purpose === 'authority-management' && !hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities)) return NextResponse.json({ error: 'Authority management permission is required.' }, { status: 403 });
    const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
    if (passkeys.length) return NextResponse.json({ error: 'This principal has a registered passkey. Use passkey verification for step-up authorization.', stepUpRequired: true, stepUpMethod: 'passkey' }, { status: 428 });
    const access = verifyPrincipalAccessToken(typeof body?.accessToken === 'string' ? body.accessToken : undefined);
    if (!access || access.profileId !== context.profileId || access.principalId !== context.principal.id) return NextResponse.json({ error: 'Fresh access grant for this principal is required.' }, { status: 401 });
    const consumed = await consumePrincipalAccessNonce(context.profileId, context.principal.id, access.nonce);
    if (!consumed) return NextResponse.json({ error: 'Principal access grant has already been used.' }, { status: 409 });
    const current = await validatePrincipalSession({ profileId: context.profileId, principalId: context.principal.id, sessionId: context.session.id, tokenVersion: context.session.tokenVersion });
    if (!current) return NextResponse.json({ error: 'Delegated session is no longer valid.' }, { status: 401 });
    const stepUpToken = createPrincipalStepUpToken({ profileId: context.profileId, principalId: context.principal.id, sessionId: current.id, tokenVersion: current.tokenVersion, purpose, method: 'access-grant', ttlSeconds: 300 });
    return NextResponse.json({ ok: true, stepUpToken, purpose, method: 'access-grant', expiresInSeconds: 300 }, { headers: { 'Cache-Control': 'no-store, private' } });
  }

  if (action === 'revoke-current') {
    if (!context.delegated || !context.session) return NextResponse.json({ error: 'No delegated session is active.' }, { status: 400 });
    await revokePrincipalSession(context.profileId, context.session.id, context.principal.id);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTHORITY_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return response;
  }

  if (action === 'revoke-session') {
    if (!hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities)) return NextResponse.json({ error: 'Authority management permission is required.' }, { status: 403 });
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
    await revokePrincipalSession(context.profileId, sessionId, context.principal.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unsupported session action.' }, { status: 400 });
}
