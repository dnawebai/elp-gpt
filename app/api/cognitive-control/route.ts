import { NextResponse } from 'next/server';
import { addEvidenceRecord, saveCommandersIntent, savePersonalConstitution } from '@/lib/cognitive-policy';
import { getCognitiveControlSnapshot } from '@/lib/cognitive-control';
import { ensureDecisionOutcomes, evaluateDecisionOutcome, evaluateDueDecisionOutcomes } from '@/lib/decision-learning';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    await ensureDecisionOutcomes(profile.profileId);
    const snapshot = await getCognitiveControlSnapshot(profile.profileId);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cognitive control snapshot failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'save-constitution') {
      const constitution = await savePersonalConstitution(profile.profileId, {
        principles: Array.isArray(body?.principles) ? body.principles.filter((v): v is string => typeof v === 'string') : [],
        hardConstraints: Array.isArray(body?.hardConstraints) ? body.hardConstraints.filter((v): v is string => typeof v === 'string') : [],
        preferences: Array.isArray(body?.preferences) ? body.preferences.filter((v): v is string => typeof v === 'string') : [],
        approvalPolicyNotes: Array.isArray(body?.approvalPolicyNotes) ? body.approvalPolicyNotes.filter((v): v is string => typeof v === 'string') : [],
      });
      return NextResponse.json({ ok: true, constitution });
    }
    if (action === 'save-intent') {
      const intent = await saveCommandersIntent(profile.profileId, {
        objective: typeof body?.objective === 'string' ? body.objective : '',
        purpose: typeof body?.purpose === 'string' ? body.purpose : '',
        endState: typeof body?.endState === 'string' ? body.endState : '',
        priorities: Array.isArray(body?.priorities) ? body.priorities.filter((v): v is string => typeof v === 'string') : [],
        constraints: Array.isArray(body?.constraints) ? body.constraints.filter((v): v is string => typeof v === 'string') : [],
        nonGoals: Array.isArray(body?.nonGoals) ? body.nonGoals.filter((v): v is string => typeof v === 'string') : [],
        timeHorizon: typeof body?.timeHorizon === 'string' ? body.timeHorizon : undefined,
      });
      return NextResponse.json({ ok: true, intent });
    }
    if (action === 'add-evidence') {
      const record = await addEvidenceRecord(profile.profileId, {
        claim: typeof body?.claim === 'string' ? body.claim : '',
        evidence: typeof body?.evidence === 'string' ? body.evidence : '',
        source: typeof body?.source === 'string' ? body.source : undefined,
        sourceType: ['user', 'internal', 'connector', 'external'].includes(String(body?.sourceType)) ? body?.sourceType as 'user' | 'internal' | 'connector' | 'external' : 'user',
        status: ['supported', 'contradicted', 'unverified'].includes(String(body?.status)) ? body?.status as 'supported' | 'contradicted' | 'unverified' : 'unverified',
        confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      });
      return NextResponse.json({ ok: true, record });
    }
    if (action === 'evaluate-decision') {
      const simulationId = typeof body?.simulationId === 'string' ? body.simulationId.trim() : '';
      if (!simulationId) return NextResponse.json({ error: 'simulationId is required.' }, { status: 400 });
      const record = await evaluateDecisionOutcome(profile.profileId, simulationId, sanitizeId(body?.sessionId, 'decision-review'));
      return NextResponse.json({ ok: true, record });
    }
    if (action === 'evaluate-due') {
      const results = await evaluateDueDecisionOutcomes(profile.profileId, sanitizeId(body?.sessionId, 'decision-review'), 4);
      return NextResponse.json({ ok: true, reviewed: results.length, results });
    }
    return NextResponse.json({ error: 'Unsupported cognitive control action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cognitive control action failed.' }, { status: 500 });
  }
}
