import { NextResponse } from 'next/server';
import { runLuke, type ChatMessage } from '@/lib/luke';
import { persistTranscript } from '@/lib/memory';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function POST(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 128_000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });

    const body = (await request.json()) as {
      messages?: Array<{ role?: string; content?: string }>;
      sessionId?: unknown;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: 'messages is required.' }, { status: 400 });
    }

    const messages = body.messages
      .filter(
        (message): message is { role: 'user' | 'assistant'; content: string } =>
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim().length > 0,
      )
      .slice(-18)
      .map((message) => ({ ...message, content: message.content.slice(0, 12_000) })) as ChatMessage[];

    if (!messages.length || messages[messages.length - 1]?.role !== 'user') {
      return NextResponse.json({ error: 'The last message must be from the user.' }, { status: 400 });
    }

    const sessionId = sanitizeId(body.sessionId, 'web');
    const lastUser = messages[messages.length - 1]!;
    await persistTranscript(profile.profileId, sessionId, 'user', lastUser.content);

    const result = await runLuke({ messages, profileId: profile.profileId, sessionId });
    await persistTranscript(profile.profileId, sessionId, 'assistant', result.text);

    return NextResponse.json(
      { message: result.text, provider: result.provider },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('LUKE chat error', error);
    return NextResponse.json(
      { error: 'LUKE is temporarily unavailable. Verify the configured model provider.' },
      { status: 502 },
    );
  }
}
