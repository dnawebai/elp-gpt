import { NextResponse } from 'next/server';
import { isComposioConfigured, searchComposioTools } from '@/lib/composio';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  if (!profileFrom(request)) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  if (!isComposioConfigured()) return NextResponse.json({ error: 'Composio is not configured.', tools: [] }, { status: 503 });

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  const toolkit = (url.searchParams.get('toolkit') || '').trim();
  if (query.length < 2) return NextResponse.json({ error: 'Search query is required.' }, { status: 400 });

  try {
    const tools = await searchComposioTools(query, toolkit || undefined);
    return NextResponse.json({ tools }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Composio tool discovery failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tool discovery failed.', tools: [] },
      { status: 502 },
    );
  }
}
