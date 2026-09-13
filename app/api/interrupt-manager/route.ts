import { NextResponse } from 'next/server';
import { getLatestInterruptSnapshot } from '@/lib/interrupt-memory';
import { runInterruptManager } from '@/lib/interrupt-manager';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  return NextResponse.json({ snapshot: await getLatestInterruptSnapshot(profile.profileId) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== 'refresh') return NextResponse.json({ error: 'Unsupported interrupt manager action.' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, snapshot: await runInterruptManager({ profileId: profile.profileId, persist: true }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Interrupt analysis failed.' }, { status: 500 });
  }
}
