import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getElpSessionSecret } from '@/lib/elp-config';

const MAX_PLAINTEXT_BYTES = 32_000;

function rootSecret() {
  return getElpSessionSecret()
    || process.env.HERMES_API_KEY
    || process.env.TOGETHER_API_KEY
    || process.env.HONCHO_API_KEY
    || process.env.DEEPGRAM_API_KEY
    || process.env.COMPOSIO_API_KEY
    || 'elp-gpt-development-only-no-provider-secret';
}

function encryptionKey(purpose: string) {
  return createHash('sha256')
    .update('elp-server-envelope:v1:')
    .update(purpose)
    .update(':')
    .update(rootSecret())
    .digest();
}

export function sealServerEnvelope(value: unknown, purpose: string) {
  const plaintext = JSON.stringify(value);
  if (Buffer.byteLength(plaintext, 'utf8') > MAX_PLAINTEXT_BYTES) {
    throw new Error('Server envelope payload is too large.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function unsealServerEnvelope<T>(sealed: string | undefined, purpose: string): T | null {
  if (!sealed) return null;
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = sealed.split('.');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(purpose), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}
