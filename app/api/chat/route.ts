import { NextResponse } from 'next/server';
import { runLucy } from '@/lib/lucy';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 128_000) {
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    }

    const body = (await request.json()) as {
      messages?: Array<{ role?: string; content?: string }>;
      profileId?: unknown;
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
      .map((message) => ({ ...message, content: message.content.slice(0, 12_000) }));

    if (!messages.length || messages[messages.length - 1]?.role !== 'user') {
      return NextResponse.json({ error: 'The last message must be from the user.' }, { status: 400 });
    }

    const result = await runLucy({
      messages,
      profileId: body.profileId,
      sessionId: body.sessionId,
    });

    return NextResponse.json(
      { message: result.text, provider: result.provider },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('LUCY chat error', error);
    return NextResponse.json(
      { error: 'LUCY is temporarily unavailable. Verify the configured model provider.' },
      { status: 502 },
    );
  }
}
