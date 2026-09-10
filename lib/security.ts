import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const PROFILE_COOKIE = 'luke_profile';

type SecurityMode = 'dedicated' | 'service-derived' | 'development';
type GatewayClaims = { kind: 'voice'; profileId: string; sessionId: string; exp: number };
type ProfileClaims = { kind: 'profile'; profileId: string; exp: number };
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
  exp: number;
};

function secretInfo(): { secret: string; mode: SecurityMode } {
  if (process.env.LUKE_SESSION_SECRET) {
    return { secret: process.env.LUKE_SESSION_SECRET, mode: 'dedicated' };
  }

  const derived =
    process.env.HERMES_API_KEY ||
    process.env.TOGETHER_API_KEY ||
    process.env.HONCHO_API_KEY ||
    process.env.DEEPGRAM_API_KEY ||
    process.env.COMPOSIO_API_KEY;

  if (derived) return { secret: derived, mode: 'service-derived' };
  return { secret: 'elp-gpt-development-only-no-provider-secret', mode: 'development' };
}

function sign(encodedPayload: string) {
  return createHmac('sha256', secretInfo().secret).update(encodedPayload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function mint<T extends object>(claims: T) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & { exp?: number };
    if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createProfileToken(profileId = randomUUID()) {
  return mint<ProfileClaims>({
    kind: 'profile',
    profileId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  });
}

export function verifyProfileToken(token: string | undefined) {
  const claims = verify<ProfileClaims>(token);
  if (!claims || claims.kind !== 'profile' || !isSafeId(claims.profileId)) return null;
  return claims;
}

export function createVoiceGatewayToken(profileId: string, sessionId: string) {
  return mint<GatewayClaims>({
    kind: 'voice',
    profileId,
    sessionId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
  });
}

export function verifyVoiceGatewayToken(token: string | undefined) {
  const claims = verify<GatewayClaims>(token);
  if (
    !claims ||
    claims.kind !== 'voice' ||
    !isSafeId(claims.profileId) ||
    !isSafeId(claims.sessionId)
  ) {
    return null;
  }
  return claims;
}

export function createActionToken(input: {
  stage: ActionTokenStage;
  profileId: string;
  sessionId: string;
  digest: string;
  risk: ActionTokenRisk;
  nonce?: string;
  ttlSeconds?: number;
}) {
  return mint<ActionClaims>({
    kind: 'action',
    stage: input.stage,
    profileId: input.profileId,
    sessionId: input.sessionId,
    digest: input.digest,
    risk: input.risk,
    nonce: input.nonce || randomUUID(),
    exp: Math.floor(Date.now() / 1000) + Math.max(30, Math.min(input.ttlSeconds || 300, 600)),
  });
}

export function verifyActionToken(token: string | undefined) {
  const claims = verify<ActionClaims>(token);
  if (
    !claims ||
    claims.kind !== 'action' ||
    !isSafeId(claims.profileId) ||
    !isSafeId(claims.sessionId) ||
    !/^[A-Za-z0-9_-]{20,100}$/.test(claims.digest) ||
    !['proposal', 'approved'].includes(claims.stage) ||
    !['read', 'write', 'high'].includes(claims.risk) ||
    typeof claims.nonce !== 'string'
  ) {
    return null;
  }
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
