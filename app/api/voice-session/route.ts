import { NextResponse } from 'next/server';
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

  if (!process.env.DEEPGRAM_API_KEY) {
    return NextResponse.json({ error: 'Deepgram is not configured.' }, { status: 503 });
  }

  const provider = getReasoningProvider();
  if (!provider) {
    return NextResponse.json({ error: 'Hermes or Together AI must be configured for LUKE voice.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
  const sessionId = sanitizeId(body.sessionId, 'web');
  const token = createVoiceGatewayToken(profile.profileId, sessionId);
  const origin = new URL(request.url).origin;

  return NextResponse.json(
    {
      token,
      thinkEndpoint: `${origin}/api/voice/think`,
      model: 'luke-router',
      reasoningProvider: provider.name,
      voiceModel: process.env.LUKE_VOICE_MODEL || 'aura-2-jupiter-en',
      listenModel: process.env.LUKE_LISTEN_MODEL || 'flux-general-en',
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
