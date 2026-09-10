export const runtime = 'nodejs';

export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response('Deepgram is not configured.', { status: 503 });
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
      return new Response('Voice token unavailable.', { status: 502 });
    }

    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token) {
      return new Response('Invalid voice token response.', { status: 502 });
    }

    return new Response(token.access_token, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    console.error('Deepgram token error', error);
    return new Response('Voice service unavailable.', { status: 502 });
  }
}
