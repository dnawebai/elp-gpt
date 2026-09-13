import { NextResponse } from 'next/server';
import { refreshExecutionSchedule } from '@/lib/execution-schedule-sync';
import { getExecutionSchedulePolicy, getLatestExecutionSchedule, saveExecutionSchedulePolicy } from '@/lib/execution-schedule-memory';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const [policy, schedule] = await Promise.all([getExecutionSchedulePolicy(profile.profileId), getLatestExecutionSchedule(profile.profileId)]);
  return NextResponse.json({ policy, schedule }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null; const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'refresh') return NextResponse.json({ ok: true, schedule: await refreshExecutionSchedule(profile.profileId) });
    if (action === 'update-policy') {
      const policy = await saveExecutionSchedulePolicy(profile.profileId, {
        ...(typeof body?.dayStartHour === 'number' ? { dayStartHour: body.dayStartHour } : {}), ...(typeof body?.dayEndHour === 'number' ? { dayEndHour: body.dayEndHour } : {}),
        ...(typeof body?.defaultFocusMinutes === 'number' ? { defaultFocusMinutes: body.defaultFocusMinutes } : {}), ...(typeof body?.minimumFocusMinutes === 'number' ? { minimumFocusMinutes: body.minimumFocusMinutes } : {}),
        ...(typeof body?.transitionBufferMinutes === 'number' ? { transitionBufferMinutes: body.transitionBufferMinutes } : {}), ...(typeof body?.meetingPrepMinutes === 'number' ? { meetingPrepMinutes: body.meetingPrepMinutes } : {}),
        ...(typeof body?.maxDeepWorkBlocks === 'number' ? { maxDeepWorkBlocks: body.maxDeepWorkBlocks } : {}), ...(typeof body?.protectDeepWork === 'boolean' ? { protectDeepWork: body.protectDeepWork } : {}), ...(typeof body?.timezone === 'string' ? { timezone: body.timezone } : {}),
      });
      return NextResponse.json({ ok: true, policy, schedule: await refreshExecutionSchedule(profile.profileId) });
    }
    return NextResponse.json({ error: 'Unsupported execution schedule action.' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Execution scheduling failed.' }, { status: 500 }); }
}
