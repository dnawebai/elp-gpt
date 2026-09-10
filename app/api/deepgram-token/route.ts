import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Deepgram is not configured.' }, { status: 503 });
  }

  try {
    const response = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Deepgram token grant failed', response.status, detail.slice(0, 200));
      return NextResponse.json({ error: 'Voice token unavailable.' }, { status: 502 });
    }

    const token = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!token.access_token) {
      return NextResponse.json({ error: 'Invalid voice token response.' }, { status: 502 });
    }

    return NextResponse.json(
      { accessToken: token.access_token, expiresIn: token.expires_in ?? 60 },
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (error) {
    console.error('Deepgram token error', error);
    return NextResponse.json({ error: 'Voice service unavailable.' }, { status: 502 });
  }
}
