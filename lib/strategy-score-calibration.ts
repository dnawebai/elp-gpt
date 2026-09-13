import type { StrategicSimulation, SimulatedOption } from '@/lib/strategic-simulation';
import { calibrationWeights, type StoredStrategyCalibration } from '@/lib/strategy-calibration-memory';

export function calibratedDecisionScore(option: SimulatedOption, calibration: StoredStrategyCalibration | null) {
  const weights = calibrationWeights(calibration);
  const scorecard = option.scorecard;
  const score =
    scorecard.strategicFit * weights.strategicFit +
    scorecard.expectedValue * weights.expectedValue +
    scorecard.reversibility * weights.reversibility +
    scorecard.evidenceStrength * weights.evidenceStrength +
    scorecard.relationshipImpact * weights.relationshipImpact +
    (100 - scorecard.downsideRisk) * weights.downsideRisk +
    (100 - scorecard.executionComplexity) * weights.executionComplexity;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function applyStrategyCalibration(simulation: StrategicSimulation, calibration: StoredStrategyCalibration | null) {
  if (!calibration || calibration.resolvedDecisions < 3) return simulation;
  const options = simulation.options.map((option) => ({
    ...option,
    scorecard: { ...option.scorecard, decisionScore: calibratedDecisionScore(option, calibration) },
  }));
  const selected = options.find((option) => option.id === simulation.recommendation.selectedOptionId);
  return {
    ...simulation,
    options,
    recommendation: selected ? {
      ...simulation.recommendation,
      selectedOptionLabel: selected.label,
    } : simulation.recommendation,
  };
}
