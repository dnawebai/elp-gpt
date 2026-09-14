import { createPasskeyChallengeToken, createPrincipalStepUpToken, type PrincipalStepUpPurpose, verifyPasskeyChallengeToken } from '@/lib/security';
import { listActivePasskeys, savePasskey, updatePasskeyUsage, type PasskeyCredentialRecord } from '@/lib/passkey-memory';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

function webauthnServer() {
  process.env.CBOR_NATIVE_ACCELERATION_DISABLED = 'true';
  return import('@simplewebauthn/server');
}

function relyingParty(request: Request) {
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const configured = (process.env.ELP_PASSKEY_RP_ID || '').trim().toLowerCase();
  const rpID = configured || (hostname === 'localhost' || hostname === '127.0.0.1' ? hostname : 'elpgpt.com');
  const local = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!local && hostname !== rpID && !hostname.endsWith(`.${rpID}`)) throw new Error('Passkeys are not available on this host.');
  if (!local && url.protocol !== 'https:') throw new Error('Passkeys require HTTPS.');
  return { rpID, origin: url.origin, rpName: 'ELP' };
}

function toPublicRecord(record: PasskeyCredentialRecord) {
  return {
    id: record.id,
    principalId: record.principalId,
    label: record.label,
    transports: record.transports,
    credentialDeviceType: record.credentialDeviceType,
    credentialBackedUp: record.credentialBackedUp,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

export async function passkeySummary(profileId: string, principalId: string) {
  const active = await listActivePasskeys(profileId, principalId);
  return active.map(toPublicRecord);
}

export async function createPasskeyRegistrationOptions(request: Request, context: ZeroTrustAuthorityContext) {
  const { generateRegistrationOptions } = await webauthnServer();
  const { rpID, rpName } = relyingParty(request);
  const existing = await listActivePasskeys(context.profileId, context.principal.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: context.principal.displayName,
    userID: new TextEncoder().encode(context.principal.id),
    attestationType: 'none',
    excludeCredentials: existing.map((item) => ({ id: item.id, transports: item.transports as never })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  return {
    options,
    challengeToken: createPasskeyChallengeToken({
      profileId: context.profileId,
      principalId: context.principal.id,
      ceremony: 'register',
      challenge: options.challenge,
      sessionId: context.session?.id,
    }),
  };
}

export async function verifyPasskeyRegistration(request: Request, context: ZeroTrustAuthorityContext, input: { challengeToken?: unknown; response?: unknown; label?: unknown }) {
  const challenge = verifyPasskeyChallengeToken(typeof input.challengeToken === 'string' ? input.challengeToken : undefined);
  if (!challenge || challenge.ceremony !== 'register' || challenge.profileId !== context.profileId || challenge.principalId !== context.principal.id) throw new Error('Invalid or expired passkey registration challenge.');
  if ((challenge.sessionId || '') !== (context.session?.id || '')) throw new Error('Passkey registration session changed.');
  const { verifyRegistrationResponse } = await webauthnServer();
  const { rpID, origin } = relyingParty(request);
  const verification = await verifyRegistrationResponse({
    response: input.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey registration could not be verified.');
  const info = verification.registrationInfo as unknown as {
    credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] };
    credentialDeviceType?: string;
    credentialBackedUp?: boolean;
  };
  const record = await savePasskey(context.profileId, {
    id: info.credential.id,
    principalId: context.principal.id,
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 120) : 'Passkey',
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: info.credential.counter,
    transports: Array.isArray(info.credential.transports) ? info.credential.transports : [],
    credentialDeviceType: info.credentialDeviceType,
    credentialBackedUp: info.credentialBackedUp,
  });
  return toPublicRecord(record);
}

export async function createPasskeyAuthenticationOptions(request: Request, context: ZeroTrustAuthorityContext, purpose: PrincipalStepUpPurpose) {
  const { generateAuthenticationOptions } = await webauthnServer();
  const { rpID } = relyingParty(request);
  const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
  if (!passkeys.length) throw new Error('No active passkey is registered for this principal.');
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: passkeys.map((item) => ({ id: item.id, transports: item.transports as never })),
  });
  return {
    options,
    challengeToken: createPasskeyChallengeToken({
      profileId: context.profileId,
      principalId: context.principal.id,
      ceremony: 'authenticate',
      challenge: options.challenge,
      sessionId: context.session?.id,
      purpose,
    }),
  };
}

export async function verifyPasskeyAuthentication(request: Request, context: ZeroTrustAuthorityContext, input: { challengeToken?: unknown; response?: unknown }) {
  const challenge = verifyPasskeyChallengeToken(typeof input.challengeToken === 'string' ? input.challengeToken : undefined);
  if (!challenge || challenge.ceremony !== 'authenticate' || !challenge.purpose || challenge.profileId !== context.profileId || challenge.principalId !== context.principal.id) throw new Error('Invalid or expired passkey authentication challenge.');
  if ((challenge.sessionId || '') !== (context.session?.id || '')) throw new Error('Passkey authentication session changed.');
  const response = input.response as { id?: string } | null;
  const credentialId = typeof response?.id === 'string' ? response.id : '';
  const passkey = (await listActivePasskeys(context.profileId, context.principal.id)).find((item) => item.id === credentialId);
  if (!passkey) throw new Error('Passkey is not registered for this principal.');
  const { verifyAuthenticationResponse } = await webauthnServer();
  const { rpID, origin } = relyingParty(request);
  const verification = await verifyAuthenticationResponse({
    response: input.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.id,
      publicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: passkey.counter,
      transports: passkey.transports as never,
    },
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error('Passkey authentication could not be verified.');
  await updatePasskeyUsage(context.profileId, context.principal.id, passkey.id, verification.authenticationInfo.newCounter);

  if (!context.delegated || !context.session) {
    return { verified: true, purpose: challenge.purpose, stepUpToken: null, ownerSession: true };
  }
  const live = await validatePrincipalSession({
    profileId: context.profileId,
    principalId: context.principal.id,
    sessionId: context.session.id,
    tokenVersion: context.session.tokenVersion,
  });
  if (!live) throw new Error('Delegated session is no longer active.');
  return {
    verified: true,
    purpose: challenge.purpose,
    stepUpToken: createPrincipalStepUpToken({
      profileId: context.profileId,
      principalId: context.principal.id,
      sessionId: live.id,
      tokenVersion: live.tokenVersion,
      purpose: challenge.purpose,
      ttlSeconds: 300,
    }),
    ownerSession: false,
  };
}
