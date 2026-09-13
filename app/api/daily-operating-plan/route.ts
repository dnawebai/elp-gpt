import { NextResponse } from 'next/server';
import { getLatestDailyOperatingPlan } from '@/lib/daily-plan-memory';
import { runDynamicPriorityEngine } from '@/lib/dynamic-priority-engine';
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
  const plan = await getLatestDailyOperatingPlan(profile.profileId);
  return NextResponse.json({ plan }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    const plan = await runDynamicPriorityEngine({ profileId: profile.profileId, persist: true });
    return NextResponse.json({ ok: true, plan }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Daily operating plan failed.' }, { status: 500 });
  }
}
