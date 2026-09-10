import { NextResponse } from 'next/server';
import { getDeepgramRuntimeConfig, isDeepgramConfigured } from '@/lib/deepgram';
import { getReasoningProvider } from '@/lib/luke';
import {
  createVoiceGatewayToken,
  PROFILE_COOKIE,
  sanitizeId,
  verifyProfileToken,
} from '@/lib/security';

export const runtime = 'nodejs';

function readCookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function POST(request: Request) {
  const profile = verifyProfileToken(readCookie(request, PROFILE_COOKIE));
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  if (!isDeepgramConfigured()) {
    return NextResponse.json({ error: 'Deepgram is not configured.' }, { status: 503 });
  }

  const provider = getReasoningProvider();
  const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
  const sessionId = sanitizeId(body.sessionId, 'web');
  const config = getDeepgramRuntimeConfig();
  const origin = new URL(request.url).origin;

  const response: Record<string, unknown> = {
    voiceModel: config.voiceModel,
    voiceSpeed: config.voiceSpeed,
    speakVersion: config.speakVersion,
    listenModel: config.listenModel,
    listenVersion: config.listenVersion,
    languageHints: config.languageHints,
    keyterms: config.keyterms,
    eotThreshold: config.eotThreshold,
    eagerEotThreshold: config.eagerEotThreshold,
    eotTimeoutMs: config.eotTimeoutMs,
    agentUrl: config.agentUrl,
    reasoningMode: provider ? 'external' : 'deepgram-managed',
    reasoningProvider: provider?.name || 'deepgram-managed',
  };

  if (provider) {
    response.token = createVoiceGatewayToken(profile.profileId, sessionId);
    response.thinkEndpoint = `${origin}/api/voice/think`;
    response.model = 'luke-router';
  } else {
    response.model = config.managedThinkModel;
  }

  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store, private' } });
}
