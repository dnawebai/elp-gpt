import { NextResponse } from 'next/server';
import { runAdaptivePriorityEngine } from '@/lib/adaptive-priority-engine';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId(); if (!profileId) return NextResponse.json({ ok: false, error: 'Daily Operating Plan requires ELP single-user mode.' }, { status: 503 });
  try { const plan = await runAdaptivePriorityEngine({ profileId, persist: true }); return NextResponse.json({ ok: true, generatedAt: plan.generatedAt, headline: plan.headline, focus: plan.focus.length, now: plan.now.length, blockers: plan.blockers.length, capacityStatus: plan.capacityStatus }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { console.error('ELP daily operating plan cron failed', error); return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Daily operating plan failed.' }, { status: 503 }); }
}
