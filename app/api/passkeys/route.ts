import { NextResponse } from 'next/server';
import { revokePasskey } from '@/lib/passkey-memory';
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  passkeySummary,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from '@/lib/passkey-service';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import { verifyPrincipalStepUpToken, type PrincipalStepUpPurpose } from '@/lib/security';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

function purpose(value: unknown): PrincipalStepUpPurpose | null {
  return value === 'high-risk-approval' || value === 'authority-management' ? value : null;
}

export async function GET(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });
  const passkeys = await passkeySummary(context.profileId, context.principal.id);
  return NextResponse.json({ principal: { id: context.principal.id, displayName: context.principal.displayName }, passkeys, supported: true }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'registration-options') {
      return NextResponse.json(await createPasskeyRegistrationOptions(request, context), { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'registration-verify') {
      const passkey = await verifyPasskeyRegistration(request, context, { challengeToken: body?.challengeToken, response: body?.response, label: body?.label });
      return NextResponse.json({ ok: true, verified: true, passkey }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'authentication-options') {
      const stepUpPurpose = purpose(body?.purpose);
      if (!stepUpPurpose) return NextResponse.json({ error: 'A valid step-up purpose is required.' }, { status: 400 });
      return NextResponse.json(await createPasskeyAuthenticationOptions(request, context, stepUpPurpose), { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'authentication-verify') {
      const result = await verifyPasskeyAuthentication(request, context, { challengeToken: body?.challengeToken, response: body?.response });
      return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'revoke') {
      const credentialId = typeof body?.credentialId === 'string' ? body.credentialId.trim() : '';
      if (!credentialId) return NextResponse.json({ error: 'credentialId is required.' }, { status: 400 });
      if (context.delegated) {
        if (!context.session) return NextResponse.json({ error: 'Delegated session is unavailable.' }, { status: 401 });
        const stepUp = verifyPrincipalStepUpToken(typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined);
        const live = await validatePrincipalSession({ profileId: context.profileId, principalId: context.principal.id, sessionId: context.session.id, tokenVersion: context.session.tokenVersion });
        if (!stepUp || !live || stepUp.purpose !== 'authority-management' || stepUp.profileId !== context.profileId || stepUp.principalId !== context.principal.id || stepUp.sessionId !== live.id || stepUp.tokenVersion !== live.tokenVersion) {
          return NextResponse.json({ error: 'Fresh passkey or delegated step-up authorization is required to revoke a passkey.' }, { status: 428 });
        }
      }
      const passkey = await revokePasskey(context.profileId, context.principal.id, credentialId);
      return NextResponse.json({ ok: true, passkey: { id: passkey.id, label: passkey.label, revokedAt: passkey.revokedAt } });
    }
    return NextResponse.json({ error: 'Unsupported passkey action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Passkey operation failed.' }, { status: 400, headers: { 'Cache-Control': 'no-store, private' } });
  }
}
