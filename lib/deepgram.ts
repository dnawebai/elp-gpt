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

export type DeepgramTranscription = {
  transcript: string;
  confidence: number | null;
};

export type DeepgramSpeech = {
  audio: Uint8Array;
  contentType: string;
  spokenText: string;
  truncated: boolean;
};

const FLUX_SPEEDS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15] as const;
const MOBILE_SPEECH_MAX_CHARS = 2200;
const MOBILE_SPEECH_MAX_BYTES = 4 * 1024 * 1024;
const AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
]);

// ELP has one permanent signature voice. Do not vary it by environment,
// deployment, session, user request, or language detection.
// Colin is Deepgram's adult British male voice with a confident,
// authoritative, trustworthy character that fits ELP's executive persona.
const ELP_SIGNATURE_VOICE = 'flux-colin-en';
const ELP_SIGNATURE_SPEED = 1;

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

function normalizeAudioMime(value: string) {
  const clean = value.toLowerCase().split(';')[0]?.trim() || '';
  return AUDIO_MIME_TYPES.has(clean) ? clean : 'audio/mp4';
}

function deepgramApiKey() {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error('Deepgram is not configured.');
  return apiKey;
}

export function getDeepgramRuntimeConfig(): DeepgramRuntimeConfig {
  const listenModel = process.env.ELP_LISTEN_MODEL || 'flux-general-multi';
  const voiceModel = ELP_SIGNATURE_VOICE;
  const isFluxVoice = voiceModel.startsWith('flux-');
  const requestedSpeed = ELP_SIGNATURE_SPEED;

  return {
    apiBaseUrl: normalizeHttpBase(process.env.DEEPGRAM_API_URL),
    agentUrl: process.env.DEEPGRAM_AGENT_URL?.trim() || null,
    listenModel,
    listenVersion: listenModel.startsWith('flux-') ? 'v2' : 'v1',
    languageHints: csv(process.env.ELP_LISTEN_LANGUAGE_HINTS, ['en', 'pt']),
    keyterms: csv(process.env.ELP_LISTEN_KEYTERMS, [
      'ELP',
      'ELP GPT',
      'Deepgram',
      'Hermes',
      'Honcho',
      'Together AI',
    ]),
    eotThreshold: boundedNumber(process.env.ELP_EOT_THRESHOLD, 0.72, 0.5, 0.9),
    eagerEotThreshold: boundedNumber(process.env.ELP_EAGER_EOT_THRESHOLD, 0.42, 0.3, 0.9),
    eotTimeoutMs: Math.round(boundedNumber(process.env.ELP_EOT_TIMEOUT_MS, 1100, 500, 10000)),
    voiceModel,
    speakVersion: isFluxVoice ? 'v2' : 'v1',
    voiceSpeed: isFluxVoice ? nearestFluxSpeed(requestedSpeed) : requestedSpeed,
    managedThinkModel: process.env.ELP_DEEPGRAM_MANAGED_LLM_MODEL || 'gpt-5-mini',
  };
}

export function isDeepgramConfigured() {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

export async function grantDeepgramToken(ttlSeconds = 300) {
  const apiKey = deepgramApiKey();
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

export async function transcribeDeepgramAudio(audio: ArrayBuffer, mimeType: string): Promise<DeepgramTranscription> {
  if (!(audio instanceof ArrayBuffer) || audio.byteLength === 0) throw new Error('Recorded audio is empty.');
  const apiKey = deepgramApiKey();
  const config = getDeepgramRuntimeConfig();
  const model = (process.env.ELP_MOBILE_TRANSCRIBE_MODEL || 'nova-3').trim().slice(0, 80) || 'nova-3';
  const query = new URLSearchParams({ model, smart_format: 'true', detect_language: 'true' });
  if (model.startsWith('nova-3')) {
    for (const term of config.keyterms.slice(0, 12)) query.append('keyterm', term);
  }
  const response = await fetch(`${config.apiBaseUrl}/v1/listen?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': normalizeAudioMime(mimeType),
    },
    body: audio,
    cache: 'no-store',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Deepgram mobile transcription failed', response.status, detail.slice(0, 300));
    throw new Error(`Voice transcription failed (${response.status}).`);
  }
  const data = (await response.json()) as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }> };
  };
  const alternative = data.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alternative?.transcript?.trim() || '';
  return {
    transcript,
    confidence: typeof alternative?.confidence === 'number' && Number.isFinite(alternative.confidence)
      ? Math.max(0, Math.min(1, alternative.confidence))
      : null,
  };
}

export async function synthesizeDeepgramSpeech(text: string): Promise<DeepgramSpeech> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Speech synthesis requires text.');
  const spokenText = clean.slice(0, MOBILE_SPEECH_MAX_CHARS);
  const apiKey = deepgramApiKey();
  const config = getDeepgramRuntimeConfig();
  const query = new URLSearchParams({
    model: ELP_SIGNATURE_VOICE,
    encoding: 'mp3',
    speed: String(ELP_SIGNATURE_SPEED),
  });
  const response = await fetch(`${config.apiBaseUrl}/v2/speak?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: spokenText }),
    cache: 'no-store',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Deepgram mobile speech synthesis failed', response.status, detail.slice(0, 300));
    throw new Error(`Voice synthesis failed (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength || arrayBuffer.byteLength > MOBILE_SPEECH_MAX_BYTES) {
    throw new Error('Voice synthesis returned an invalid audio payload.');
  }
  return {
    audio: new Uint8Array(arrayBuffer),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    spokenText,
    truncated: spokenText.length < clean.length,
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
