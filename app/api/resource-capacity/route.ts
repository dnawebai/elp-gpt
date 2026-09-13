import { NextResponse } from 'next/server';
import { getCapacityProfile, getLatestCapacityPlan, saveCapacityProfile } from '@/lib/capacity-memory';
import { runResourceCapacityPlanner } from '@/lib/resource-capacity-planner';
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
  try {
    const [capacityProfile, latestPlan] = await Promise.all([getCapacityProfile(profile.profileId), getLatestCapacityPlan(profile.profileId)]);
    return NextResponse.json({ ok: true, profile: capacityProfile, plan: latestPlan }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Capacity snapshot failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : 'run';
  try {
    if (action === 'save-profile') {
      const saved = await saveCapacityProfile(profile.profileId, {
        weeklyHours: typeof body?.weeklyHours === 'number' ? body.weeklyHours : undefined,
        reservePercent: typeof body?.reservePercent === 'number' ? body.reservePercent : undefined,
        adminPercent: typeof body?.adminPercent === 'number' ? body.adminPercent : undefined,
        maxConcurrentObjectives: typeof body?.maxConcurrentObjectives === 'number' ? body.maxConcurrentObjectives : undefined,
        defaultTaskHours: typeof body?.defaultTaskHours === 'number' ? body.defaultTaskHours : undefined,
        timezone: typeof body?.timezone === 'string' ? body.timezone : undefined,
      });
      return NextResponse.json({ ok: true, profile: saved });
    }
    if (action === 'run') {
      const plan = await runResourceCapacityPlanner({
        profileId: profile.profileId,
        persist: true,
        createRecoveryTasks: body?.createRecoveryTasks !== false,
        horizonDays: typeof body?.horizonDays === 'number' ? body.horizonDays : 7,
      });
      return NextResponse.json({ ok: true, plan }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    return NextResponse.json({ error: 'Unsupported capacity action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Capacity planning failed.' }, { status: 500 });
  }
}
