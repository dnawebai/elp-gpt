import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(secret: string, encodedPayload: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function mintSignedToken<T extends object>(secret: string, claims: T) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function verifySignedToken<T extends { exp?: number }>(
  secret: string,
  token: string | undefined,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): T | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(secret, payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
    if (typeof parsed.exp !== 'number' || parsed.exp <= nowEpochSeconds) return null;
    return parsed;
  } catch {
    return null;
  }
}
