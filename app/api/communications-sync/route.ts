import { NextResponse } from 'next/server';
import { getCommunicationsSyncSnapshot, runCommunicationsSync } from '@/lib/communications-sync';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    return NextResponse.json(await getCommunicationsSyncSnapshot(profile.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Communications sync status failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== 'refresh') return NextResponse.json({ error: 'Unsupported communications sync action.' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, run: await runCommunicationsSync({ profileId: profile.profileId, persist: true }) }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Communications sync failed.' }, { status: 500 });
  }
}
