'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

export type PasskeyStepUpPurpose = 'high-risk-approval' | 'authority-management';
type Fetcher = typeof window.fetch;

async function json(response: Response) {
  return response.json().catch(() => ({ error: 'ELP returned an invalid passkey response.' })) as Promise<Record<string, unknown>>;
}

export async function registerElpPasskey(label = 'Passkey', fetcher: Fetcher = window.fetch.bind(window)) {
  const optionsResponse = await fetcher('/api/passkeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'registration-options' }),
    cache: 'no-store',
  });
  const optionsData = await json(optionsResponse);
  if (!optionsResponse.ok) throw new Error(String(optionsData.error || 'Could not create passkey registration options.'));
  const optionsJSON = optionsData.options as Parameters<typeof startRegistration>[0]['optionsJSON'];
  const credential = await startRegistration({ optionsJSON });
  const verifyResponse = await fetcher('/api/passkeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'registration-verify', challengeToken: optionsData.challengeToken, response: credential, label }),
    cache: 'no-store',
  });
  const verified = await json(verifyResponse);
  if (!verifyResponse.ok) throw new Error(String(verified.error || 'Passkey registration failed.'));
  return verified;
}

export async function performPasskeyStepUp(purpose: PasskeyStepUpPurpose, fetcher: Fetcher = window.fetch.bind(window)) {
  const optionsResponse = await fetcher('/api/passkeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'authentication-options', purpose }),
    cache: 'no-store',
  });
  const optionsData = await json(optionsResponse);
  if (!optionsResponse.ok) throw new Error(String(optionsData.error || 'Could not create passkey authentication options.'));
  const optionsJSON = optionsData.options as Parameters<typeof startAuthentication>[0]['optionsJSON'];
  const credential = await startAuthentication({ optionsJSON });
  const verifyResponse = await fetcher('/api/passkeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'authentication-verify', challengeToken: optionsData.challengeToken, response: credential }),
    cache: 'no-store',
  });
  const verified = await json(verifyResponse);
  if (!verifyResponse.ok || typeof verified.stepUpToken !== 'string') throw new Error(String(verified.error || 'Passkey verification failed.'));
  return verified.stepUpToken;
}
