import { randomUUID } from 'node:crypto';
import { getElpSessionSecret } from '@/lib/elp-config';
import { mintSignedToken, verifySignedToken } from '@/lib/token-codec';

export const PROFILE_COOKIE = 'elp_profile';
export const AUTHORITY_COOKIE = 'elp_authority';

type SecurityMode = 'dedicated' | 'service-derived' | 'development';
type GatewayClaims = { kind: 'voice'; profileId: string; sessionId: string; exp: number };
type ProfileClaims = { kind: 'profile'; profileId: string; exp: number };
type PrincipalAccessClaims = { kind: 'principal-access'; profileId: string; principalId: string; nonce: string; exp: number };
export type PrincipalSessionAssurance = 'standard' | 'step_up';
type PrincipalSessionClaims = {
  kind: 'principal-session';
  profileId: string;
  principalId: string;
  sessionId: string;
  tokenVersion: string;
  assurance: PrincipalSessionAssurance;
  exp: number;
};
export type PrincipalStepUpPurpose = 'high-risk-approval' | 'authority-management';
export type PrincipalStepUpMethod = 'access-grant' | 'passkey';
type PrincipalStepUpClaims = {
  kind: 'principal-step-up';
  profileId: string;
  principalId: string;
  sessionId: string;
  tokenVersion: string;
  purpose: PrincipalStepUpPurpose;
  method?: PrincipalStepUpMethod;
  nonce: string;
  exp: number;
};
type PasskeyChallengeClaims = {
  kind: 'passkey-challenge';
  profileId: string;
  principalId: string;
  ceremony: 'register' | 'authenticate';
  challenge: string;
  sessionId?: string;
  purpose?: PrincipalStepUpPurpose;
  exp: number;
};
type CompanionEnrollmentClaims = { kind: 'companion-enrollment'; profileId: string; principalId: string; enrollmentId: string; nonce: string; exp: number };
type CompanionClaims = { kind: 'companion'; profileId: string; principalId: string; deviceId: string; tokenVersion: string; exp: number };
export type ActionTokenStage = 'proposal' | 'approved';
export type ActionTokenRisk = 'read' | 'write' | 'high';
type ActionClaims = {
  kind: 'action';
  stage: ActionTokenStage;
  profileId: string;
  sessionId: string;
  digest: string;
  risk: ActionTokenRisk;
  nonce: string;
  principalId?: string;
  exp: number;
};

function secretInfo(): { secret: string; mode: SecurityMode } {
  const dedicated = getElpSessionSecret();
  if (dedicated) return { secret: dedicated, mode: 'dedicated' };

  const derived =
    process.env.HERMES_API_KEY ||
    process.env.TOGETHER_API_KEY ||
    process.env.HONCHO_API_KEY ||
    process.env.DEEPGRAM_API_KEY ||
    process.env.COMPOSIO_API_KEY;

  if (derived) return { secret: derived, mode: 'service-derived' };
  return { secret: 'elp-gpt-development-only-no-provider-secret', mode: 'development' };
}

function mint<T extends object>(claims: T) {
  return mintSignedToken(secretInfo().secret, claims);
}

function verify<T extends { exp?: number }>(token: string | undefined): T | null {
  return verifySignedToken<T>(secretInfo().secret, token);
}

export function createProfileToken(profileId: string = randomUUID()) {
  return mint<ProfileClaims>({ kind: 'profile', profileId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 });
}

export function verifyProfileToken(token: string | undefined) {
  const claims = verify<ProfileClaims>(token);
  if (!claims || claims.kind !== 'profile' || !isSafeId(claims.profileId)) return null;
  return claims;
}

export function createPrincipalAccessToken(profileId: string, principalId: string, ttlSeconds = 86_400) {
  return mint<PrincipalAccessClaims>({ kind: 'principal-access', profileId, principalId, nonce: randomUUID(), exp: Math.floor(Date.now() / 1000) + Math.max(300, Math.min(ttlSeconds, 86_400)) });
}

export function verifyPrincipalAccessToken(token: string | undefined) {
  const claims = verify<PrincipalAccessClaims>(token);
  if (!claims || claims.kind !== 'principal-access' || !isSafeId(claims.profileId) || !isSafeId(claims.principalId) || !isSafeId(claims.nonce)) return null;
  return claims;
}

export function createPrincipalSessionToken(
  profileId: string,
  principalId: string,
  options: number | { ttlSeconds?: number; sessionId?: string; tokenVersion?: string; assurance?: PrincipalSessionAssurance } = 60 * 60 * 12,
) {
  const config = typeof options === 'number' ? { ttlSeconds: options } : options;
  const ttlSeconds = Math.max(900, Math.min(config.ttlSeconds || 60 * 60 * 12, 60 * 60 * 24 * 30));
  return mint<PrincipalSessionClaims>({
    kind: 'principal-session', profileId, principalId, sessionId: config.sessionId || randomUUID(), tokenVersion: config.tokenVersion || randomUUID(), assurance: config.assurance || 'standard', exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export function verifyPrincipalSessionToken(token: string | undefined) {
  const claims = verify<PrincipalSessionClaims>(token);
  if (!claims || claims.kind !== 'principal-session' || !isSafeId(claims.profileId) || !isSafeId(claims.principalId) || !isSafeId(claims.sessionId) || !isSafeId(claims.tokenVersion) || !['standard','step_up'].includes(claims.assurance)) return null;
  return claims;
}

export function createPrincipalStepUpToken(input: {
  profileId: string;
  principalId: string;
  sessionId: string;
  tokenVersion: string;
  purpose: PrincipalStepUpPurpose;
  method?: PrincipalStepUpMethod;
  ttlSeconds?: number;
}) {
  return mint<PrincipalStepUpClaims>({
    kind: 'principal-step-up', profileId: input.profileId, principalId: input.principalId, sessionId: input.sessionId, tokenVersion: input.tokenVersion, purpose: input.purpose, method: input.method || 'access-grant', nonce: randomUUID(), exp: Math.floor(Date.now() / 1000) + Math.max(30, Math.min(input.ttlSeconds || 300, 600)),
  });
}

export function verifyPrincipalStepUpToken(token: string | undefined) {
  const claims = verify<PrincipalStepUpClaims>(token);
  if (!claims || claims.kind !== 'principal-step-up' || !isSafeId(claims.profileId) || !isSafeId(claims.principalId) || !isSafeId(claims.sessionId) || !isSafeId(claims.tokenVersion) || !isSafeId(claims.nonce) || !['high-risk-approval','authority-management'].includes(claims.purpose) || (claims.method !== undefined && !['access-grant','passkey'].includes(claims.method))) return null;
  return { ...claims, method: claims.method || 'access-grant' };
}

export function createPasskeyChallengeToken(input: {
  profileId: string;
  principalId: string;
  ceremony: 'register' | 'authenticate';
  challenge: string;
  sessionId?: string;
  purpose?: PrincipalStepUpPurpose;
  ttlSeconds?: number;
}) {
  return mint<PasskeyChallengeClaims>({
    kind: 'passkey-challenge', profileId: input.profileId, principalId: input.principalId, ceremony: input.ceremony, challenge: input.challenge, ...(input.sessionId ? { sessionId: input.sessionId } : {}), ...(input.purpose ? { purpose: input.purpose } : {}), exp: Math.floor(Date.now() / 1000) + Math.max(60, Math.min(input.ttlSeconds || 300, 600)),
  });
}

export function verifyPasskeyChallengeToken(token: string | undefined) {
  const claims = verify<PasskeyChallengeClaims>(token);
  if (!claims || claims.kind !== 'passkey-challenge' || !isSafeId(claims.profileId) || !isSafeId(claims.principalId) || !['register','authenticate'].includes(claims.ceremony) || !/^[A-Za-z0-9_-]{20,512}$/.test(claims.challenge) || (claims.sessionId !== undefined && !isSafeId(claims.sessionId)) || (claims.purpose !== undefined && !['high-risk-approval','authority-management'].includes(claims.purpose))) return null;
  return claims;
}

export function createCompanionEnrollmentToken(input: { profileId: string; principalId: string; enrollmentId: string; nonce: string; ttlSeconds?: number }) {
  return mint<CompanionEnrollmentClaims>({ kind: 'companion-enrollment', profileId: input.profileId, principalId: input.principalId, enrollmentId: input.enrollmentId, nonce: input.nonce, exp: Math.floor(Date.now() / 1000) + Math.max(300, Math.min(input.ttlSeconds || 1800, 86_400)) });
}

export function verifyCompanionEnrollmentToken(token: string | undefined) {
  const claims = verify<CompanionEnrollmentClaims>(token);
  if (!claims || claims.kind !== 'companion-enrollment' || !isSafeId(claims.profileId) || !isSafeId(claims.principalId) || !isSafeId(claims.enrollmentId) || !isSafeId(claims.nonce)) return null;
  return claims;
}

export function createCompanionToken(input: { profileId: string; principalId: string; deviceId: string; tokenVersion: string; ttlSeconds?: number }) {
  return mint<CompanionClaims>({ kind: 'companion', profileId: input.profileId, principalId: input.principalId, deviceId: input.deviceId, tokenVersion: input.tokenVersion, exp: Math.floor(Date.now() / 1000) + Math.max(3600, Math.min(input.ttlSeconds || 60 * 60 * 24 * 90, 60 * 60 * 24 * 180)) });
}

export function verifyCompanionToken(token: string | undefined) {
  const claims = verify<CompanionClaims>(token);
  if (!claims || claims.kind !== 'companion' || !isSafeId(claims.profileId) || !isSafeId(claims.principalId) || !isSafeId(claims.deviceId) || !isSafeId(claims.tokenVersion)) return null;
  return claims;
}

export function createVoiceGatewayToken(profileId: string, sessionId: string) {
  return mint<GatewayClaims>({ kind: 'voice', profileId, sessionId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2 });
}

export function verifyVoiceGatewayToken(token: string | undefined) {
  const claims = verify<GatewayClaims>(token);
  if (!claims || claims.kind !== 'voice' || !isSafeId(claims.profileId) || !isSafeId(claims.sessionId)) return null;
  return claims;
}

export function createActionToken(input: {
  stage: ActionTokenStage;
  profileId: string;
  sessionId: string;
  digest: string;
  risk: ActionTokenRisk;
  nonce?: string;
  principalId?: string;
  ttlSeconds?: number;
}) {
  return mint<ActionClaims>({ kind: 'action', stage: input.stage, profileId: input.profileId, sessionId: input.sessionId, digest: input.digest, risk: input.risk, nonce: input.nonce || randomUUID(), ...(input.principalId ? { principalId: input.principalId } : {}), exp: Math.floor(Date.now() / 1000) + Math.max(30, Math.min(input.ttlSeconds || 300, 600)) });
}

export function verifyActionToken(token: string | undefined) {
  const claims = verify<ActionClaims>(token);
  if (!claims || claims.kind !== 'action' || !isSafeId(claims.profileId) || !isSafeId(claims.sessionId) || !/^[A-Za-z0-9_-]{20,100}$/.test(claims.digest) || !['proposal', 'approved'].includes(claims.stage) || !['read', 'write', 'high'].includes(claims.risk) || typeof claims.nonce !== 'string' || (claims.principalId !== undefined && !isSafeId(claims.principalId))) return null;
  return claims;
}

export function bearerToken(header: string | null) {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function sanitizeId(value: unknown, fallback = 'web') {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
  return clean || fallback;
}

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(value);
}

export function getSecurityMode(): SecurityMode {
  return secretInfo().mode;
}
