'use client';

import { useEffect } from 'react';
import { performPasskeyStepUp, type PasskeyStepUpPurpose } from '@/lib/passkey-client';

function targetPurpose(url: string): PasskeyStepUpPurpose | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    if (parsed.pathname === '/api/actions/approve') return 'high-risk-approval';
    if (parsed.pathname === '/api/authority-control' || parsed.pathname === '/api/passkeys' || parsed.pathname === '/api/security-operations') return 'authority-management';
    return null;
  } catch { return null; }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body;
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try { return await input.clone().text(); } catch { return ''; }
  }
  return '';
}

export default function PasskeyStepUpBridge() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let steppingUp = false;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const purpose = targetPurpose(requestUrl(input));
      if (!purpose || response.status !== 428 || steppingUp) return response;

      let signal: Record<string, unknown> | null = null;
      try { signal = await response.clone().json() as Record<string, unknown>; } catch { return response; }
      if (signal?.stepUpRequired !== true || signal?.stepUpMethod !== 'passkey') return response;

      const rawBody = await requestBody(input, init);
      if (!rawBody) return response;
      let parsedBody: Record<string, unknown>;
      try { parsedBody = JSON.parse(rawBody) as Record<string, unknown>; } catch { return response; }

      steppingUp = true;
      try {
        const stepUpToken = await performPasskeyStepUp(purpose, originalFetch);
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('Content-Type', 'application/json');
        return await originalFetch(requestUrl(input), {
          ...init,
          method: init?.method || (input instanceof Request ? input.method : 'POST'),
          headers,
          body: JSON.stringify({ ...parsedBody, stepUpToken }),
          cache: 'no-store',
        });
      } finally {
        steppingUp = false;
      }
    }) as typeof window.fetch;

    return () => { window.fetch = originalFetch; };
  }, []);

  return null;
}
