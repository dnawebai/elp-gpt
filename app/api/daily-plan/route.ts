import { NextResponse } from 'next/server';
import { runAdaptivePriorityEngine } from '@/lib/adaptive-priority-engine';
import { getLatestDailyOperatingPlan } from '@/lib/daily-plan-memory';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function profileFrom(request: Request) {
  const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  return NextResponse.json({ plan: await getLatestDailyOperatingPlan(profile.profileId) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== 'refresh') return NextResponse.json({ error: 'Unsupported daily plan action.' }, { status: 400 });
  try { return NextResponse.json({ ok: true, plan: await runAdaptivePriorityEngine({ profileId: profile.profileId, persist: true }) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Daily plan generation failed.' }, { status: 500 }); }
}
