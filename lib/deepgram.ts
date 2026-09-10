export type DeepgramConnectionStatus = {
  configured: boolean;
  authenticated: boolean;
  latencyMs: number | null;
  error: string | null;
};

export type DeepgramRuntimeConfig = {
  apiBaseUrl: string;
  agentUrl: string | null;
  listenModel: string;
  listenVersion: 'v1' | 'v2';
  languageHints: string[];
  keyterms: string[];
  eotThreshold: number;
  eagerEotThreshold: number;
  eotTimeoutMs: number;
  voiceModel: string;
  speakVersion: 'v1' | 'v2';
  voiceSpeed: number;
  managedThinkModel: string;
};

const FLUX_SPEEDS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const;

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function nearestFluxSpeed(value: number) {
  return FLUX_SPEEDS.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}

function csv(value: string | undefined, fallback: string[]) {
  const items = (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items.slice(0, 20) : fallback;
}

function normalizeHttpBase(value: string | undefined) {
  const base = (value || 'https://api.deepgram.com').trim().replace(/\/$/, '');
  return /^https:\/\//i.test(base) ? base : 'https://api.deepgram.com';
}

export function getDeepgramRuntimeConfig(): DeepgramRuntimeConfig {
  const listenModel = process.env.LUKE_LISTEN_MODEL || 'flux-general-multi';
  const voiceModel = process.env.LUKE_VOICE_MODEL || 'flux-cliff-en';
  const isFluxVoice = voiceModel.startsWith('flux-');
  const requestedSpeed = boundedNumber(process.env.LUKE_VOICE_SPEED, 1, 0.7, 1.5);

  return {
    apiBaseUrl: normalizeHttpBase(process.env.DEEPGRAM_API_URL),
    agentUrl: process.env.DEEPGRAM_AGENT_URL?.trim() || null,
    listenModel,
    listenVersion: listenModel.startsWith('flux-') ? 'v2' : 'v1',
    languageHints: csv(process.env.LUKE_LISTEN_LANGUAGE_HINTS, ['en', 'pt']),
    keyterms: csv(process.env.LUKE_LISTEN_KEYTERMS, [
      'LUKE',
      'ELP GPT',
      'Deepgram',
      'Hermes',
      'Honcho',
      'Together AI',
    ]),
    eotThreshold: boundedNumber(process.env.LUKE_EOT_THRESHOLD, 0.78, 0.5, 0.9),
    eagerEotThreshold: boundedNumber(process.env.LUKE_EAGER_EOT_THRESHOLD, 0.5, 0.3, 0.9),
    eotTimeoutMs: Math.round(boundedNumber(process.env.LUKE_EOT_TIMEOUT_MS, 2600, 500, 10000)),
    voiceModel,
    speakVersion: isFluxVoice ? 'v2' : 'v1',
    voiceSpeed: isFluxVoice ? nearestFluxSpeed(requestedSpeed) : requestedSpeed,
    managedThinkModel: process.env.LUKE_DEEPGRAM_MANAGED_LLM_MODEL || 'gpt-5-mini',
  };
}

export function isDeepgramConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

export async function grantDeepgramToken(ttlSeconds = 300) {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error('Deepgram is not configured.');

  const ttl = Math.round(Math.min(3600, Math.max(30, ttlSeconds)));
  const config = getDeepgramRuntimeConfig();
  const response = await fetch(`${config.apiBaseUrl}/v1/auth/grant`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: ttl }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Deepgram token grant failed', response.status, detail.slice(0, 240));
    throw new Error(`Deepgram authentication failed (${response.status}).`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Deepgram returned an invalid token response.');

  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : ttl,
  };
}

export async function verifyDeepgramConnection(): Promise<DeepgramConnectionStatus> {
  if (!isDeepgramConfigured()) {
    return { configured: false, authenticated: false, latencyMs: null, error: null };
  }

  const started = Date.now();
  try {
    await grantDeepgramToken(30);
    return {
      configured: true,
      authenticated: true,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      authenticated: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Deepgram authentication failed.',
    };
  }
}
