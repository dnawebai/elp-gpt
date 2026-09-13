import { getCognitivePolicySnapshot, cognitivePolicyToPrompt } from '@/lib/cognitive-policy';
import { listDecisionOutcomes } from '@/lib/decision-learning';
import { getStoredStrategyCalibration, strategyCalibrationToPrompt } from '@/lib/strategy-calibration-memory';
import { getStrategicSimulation, listStrategicSimulations, runStrategicSimulation } from '@/lib/strategic-simulation';

export type DecisionTimeMachineRecord = {
  simulationId: string;
  decision: string;
  decisionTime: string;
  selectedOptionLabel: string;
  originalRecommendation: string;
  originalConfidence: number;
  originalContext: string;
  originalAssumptions: string[];
  originalPreMortem: string[];
  originalReversalTriggers: string[];
  outcome?: {
    status: string;
    outcomeScore: number;
    forecastAccuracy: number;
    confidence: number;
    summary: string;
    evidence: string[];
    lessons: string[];
    assumptions: Array<{ text:string; status:string; confidence:number; evidence:string[] }>;
    updatedAt: string;
  };
};

function clip(value: string, max = 12000) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }

export async function listDecisionTimeMachineRecords(profileId: string) {
  const [simulations, outcomes] = await Promise.all([listStrategicSimulations(profileId), listDecisionOutcomes(profileId)]);
  const outcomesBySimulation = new Map(outcomes.map((item) => [item.simulationId, item]));
  return simulations.filter((item) => item.promotedLedgerId).map((simulation): DecisionTimeMachineRecord => {
    const outcome = outcomesBySimulation.get(simulation.id);
    return {
      simulationId: simulation.id,
      decision: simulation.decision,
      decisionTime: simulation.generatedAt,
      selectedOptionLabel: simulation.recommendation.selectedOptionLabel,
      originalRecommendation: simulation.recommendation.recommendation,
      originalConfidence: simulation.recommendation.confidence,
      originalContext: simulation.contextSummary,
      originalAssumptions: simulation.recommendation.assumptionsToVerify,
      originalPreMortem: simulation.recommendation.preMortem,
      originalReversalTriggers: simulation.recommendation.reversalTriggers,
      ...(outcome ? { outcome: { status: outcome.status, outcomeScore: outcome.outcomeScore, forecastAccuracy: outcome.forecastAccuracy, confidence: outcome.confidence, summary: outcome.summary, evidence: outcome.evidence, lessons: outcome.lessons, assumptions: outcome.assumptions.map((item) => ({ text: item.text, status: item.status, confidence: item.confidence, evidence: item.evidence })), updatedAt: outcome.updatedAt } } : {}),
    };
  });
}

export async function getDecisionTimeMachineRecord(profileId: string, simulationId: string) {
  const records = await listDecisionTimeMachineRecords(profileId);
  return records.find((item) => item.simulationId === simulationId) || null;
}

export async function replayDecisionAtPresent(profileId: string, simulationId: string, sessionId: string) {
  const original = await getStrategicSimulation(profileId, simulationId);
  if (!original) throw new Error('Strategic simulation not found.');
  const [policy, calibration] = await Promise.all([getCognitivePolicySnapshot(profileId), getStoredStrategyCalibration(profileId)]);
  const policyText = cognitivePolicyToPrompt(policy);
  const calibrationText = strategyCalibrationToPrompt(calibration);
  const historical = `HISTORICAL DECISION RECORD — immutable reference, not current truth:\nDecision time: ${original.generatedAt}\nOriginal context: ${clip(original.contextSummary, 10000)}\nOriginal recommendation: ${original.recommendation.selectedOptionLabel} — ${original.recommendation.recommendation}\nOriginal assumptions: ${original.recommendation.assumptionsToVerify.join(' | ') || 'none'}\nOriginal reversal triggers: ${original.recommendation.reversalTriggers.join(' | ') || 'none'}`;
  const currentContext = [historical, policyText, calibrationText, 'REPLAY RULE: Evaluate the same original options using current evidence/context available to ELP. Do not rewrite the historical recommendation or imply the earlier decision was irrational merely because outcomes are now known. Separate hindsight from information that was genuinely available then.'].filter(Boolean).join('\n\n');
  const replay = await runStrategicSimulation({
    decision: original.decision,
    objective: original.objective,
    context: currentContext,
    options: original.options.map((item) => ({ label: item.label, description: item.description })),
    profileId,
    sessionId: `${sessionId}-decision-replay`,
    persist: false,
  });
  return {
    original: {
      simulationId: original.id,
      generatedAt: original.generatedAt,
      selectedOptionLabel: original.recommendation.selectedOptionLabel,
      recommendation: original.recommendation.recommendation,
      confidence: original.recommendation.confidence,
    },
    replay: {
      generatedAt: replay.generatedAt,
      selectedOptionLabel: replay.recommendation.selectedOptionLabel,
      recommendation: replay.recommendation.recommendation,
      confidence: replay.recommendation.confidence,
      assumptionsToVerify: replay.recommendation.assumptionsToVerify,
      materialDissent: replay.recommendation.materialDissent,
      reversalTriggers: replay.recommendation.reversalTriggers,
      options: replay.options.map((item) => ({ label: item.label, decisionScore: item.scorecard.decisionScore, baseCase: item.baseCase, worstCase: item.worstCase })),
    },
    changedRecommendation: original.recommendation.selectedOptionLabel.toLowerCase() !== replay.recommendation.selectedOptionLabel.toLowerCase(),
  };
}
