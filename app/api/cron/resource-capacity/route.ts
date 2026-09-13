import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { runResourceCapacityPlanner } from '@/lib/resource-capacity-planner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Resource Capacity Planner requires ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  try {
    const slot = Math.floor(Date.now() / (4 * 60 * 60 * 1000));
    const plan = await runResourceCapacityPlanner({ profileId, persist: true, createRecoveryTasks: true, horizonDays: 7 });
    return NextResponse.json({ ok: true, slot, generatedAt: plan.generatedAt, status: plan.status, demandHours: plan.estimatedDemandHours, capacityHours: plan.executionCapacityHours, gapHours: plan.capacityGapHours, recommendations: plan.recommendations.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP resource capacity cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Capacity planning failed.' }, { status: 503 });
  }
}
