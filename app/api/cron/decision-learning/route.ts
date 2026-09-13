import { NextResponse } from 'next/server';
import { evaluateDueDecisionOutcomes, getStrategyCalibration } from '@/lib/decision-learning';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { persistStrategyCalibration } from '@/lib/strategy-calibration-memory';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Decision learning requires ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  try {
    const slot = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
    const results = await evaluateDueDecisionOutcomes(profileId, `decision-learning-cron-${slot}`, 4);
    const calibration = await getStrategyCalibration(profileId);
    await persistStrategyCalibration(profileId, calibration);
    return NextResponse.json({ ok: true, slot, reviewed: results.length, calibration: { resolvedDecisions: calibration.resolvedDecisions, averageForecastAccuracy: calibration.averageForecastAccuracy, averageOutcomeScore: calibration.averageOutcomeScore, assumptionHitRate: calibration.assumptionHitRate } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP decision learning cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Decision learning failed.' }, { status: 503 });
  }
}
