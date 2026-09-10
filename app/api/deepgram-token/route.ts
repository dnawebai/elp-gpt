import { grantDeepgramToken } from '@/lib/deepgram';

export const runtime = 'nodejs';

async function grant() {
  try {
    const { accessToken } = await grantDeepgramToken(300);
    return new Response(accessToken, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voice service unavailable.';
    const status = message.includes('not configured') ? 503 : 502;
    console.error('Deepgram token error', error);
    return new Response(message, { status });
  }
}

export async function GET() {
  return grant();
}

export async function POST() {
  return grant();
}
