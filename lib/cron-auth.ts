import { timingSafeEqual } from 'node:crypto';

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isCronAuthorised(authorization: string | null, secretValue: string | undefined = process.env.CRON_SECRET) {
  const secret = secretValue?.trim();
  if (!secret || !authorization) return false;
  const expected = `Bearer ${secret}`;
  return safeEqual(authorization, expected);
}

export function isCronRequestAuthorised(request: Request) {
  return isCronAuthorised(request.headers.get('authorization'));
}
