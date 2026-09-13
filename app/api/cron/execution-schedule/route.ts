import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { refreshExecutionSchedule } from '@/lib/execution-schedule-sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Execution Scheduler requires ELP single-user mode.' }, { status: 503 });
  try {
    const slot = Math.floor(Date.now() / (60 * 60 * 1000));
    const schedule = await refreshExecutionSchedule(profileId);
    return NextResponse.json({ ok: true, slot, generatedAt: schedule.generatedAt, date: schedule.date, blocks: schedule.blocks.length, focusMinutes: schedule.stats.focusMinutes, scheduledPriorities: schedule.stats.scheduledPriorities, unscheduledPriorities: schedule.stats.unscheduledPriorities }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP execution schedule cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Execution scheduling failed.' }, { status: 503 });
  }
}
