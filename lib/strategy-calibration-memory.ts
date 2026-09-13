import { Honcho } from '@honcho-ai/sdk';

export type StoredStrategyCalibration = {
  sampleSize: number;
  resolvedDecisions: number;
  averageForecastAccuracy: number;
  averageOutcomeScore: number;
  assumptionHitRate: number;
  dimensions: {
    strategicFit: number;
    expectedValue: number;
    downsideRisk: number;
    reversibility: number;
    executionComplexity: number;
    evidenceStrength: number;
    relationshipImpact: number;
  };
  recurringLessons: string[];
  generatedAt: string;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`strategy-calibration-${profileId}`);
  await session.addPeers([elp]);
  return { elp, session };
}

export async function persistStrategyCalibration(profileId: string, calibration: StoredStrategyCalibration) {
  const handles = await getSession(profileId);
  if (!handles) return calibration;
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[STRATEGY_CALIBRATION] ${calibration.generatedAt}\nResolved decisions: ${calibration.resolvedDecisions}; forecast accuracy: ${calibration.averageForecastAccuracy}%; outcome score: ${calibration.averageOutcomeScore}%.`, metadata: { jarbisStrategyCalibration: true, recordVersion: 1, generatedAt: calibration.generatedAt, calibrationJson: JSON.stringify(calibration) } }]);
  return calibration;
}

export async function getStoredStrategyCalibration(profileId: string): Promise<StoredStrategyCalibration | null> {
  const handles = await getSession(profileId);
  if (!handles) return null;
  try {
    const page = await handles.session.messages({ size: 20, reverse: true });
    for (const item of page.items) {
      if (item.metadata?.jarbisStrategyCalibration !== true || typeof item.metadata.calibrationJson !== 'string') continue;
      try {
        const parsed = JSON.parse(item.metadata.calibrationJson) as StoredStrategyCalibration;
        if (parsed && typeof parsed.resolvedDecisions === 'number' && parsed.dimensions) return parsed;
      } catch {}
    }
  } catch (error) { console.error('ELP strategy calibration read failed', error); }
  return null;
}

export function calibrationWeights(calibration: StoredStrategyCalibration | null) {
  const base = { strategicFit: 0.22, expectedValue: 0.25, reversibility: 0.15, evidenceStrength: 0.15, relationshipImpact: 0.08, downsideRisk: 0.10, executionComplexity: 0.05 };
  if (!calibration || calibration.resolvedDecisions < 3) return base;
  const accuracy = calibration.dimensions;
  const reliability = {
    strategicFit: Math.max(0.5, accuracy.strategicFit / 100),
    expectedValue: Math.max(0.5, accuracy.expectedValue / 100),
    reversibility: Math.max(0.5, accuracy.reversibility / 100),
    evidenceStrength: Math.max(0.5, accuracy.evidenceStrength / 100),
    relationshipImpact: Math.max(0.5, accuracy.relationshipImpact / 100),
    downsideRisk: Math.max(0.5, accuracy.downsideRisk / 100),
    executionComplexity: Math.max(0.5, accuracy.executionComplexity / 100),
  };
  const raw = {
    strategicFit: base.strategicFit * reliability.strategicFit,
    expectedValue: base.expectedValue * reliability.expectedValue,
    reversibility: base.reversibility * reliability.reversibility,
    evidenceStrength: base.evidenceStrength * reliability.evidenceStrength,
    relationshipImpact: base.relationshipImpact * reliability.relationshipImpact,
    downsideRisk: base.downsideRisk * reliability.downsideRisk,
    executionComplexity: base.executionComplexity * reliability.executionComplexity,
  };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / total])) as typeof base;
}

export function strategyCalibrationToPrompt(calibration: StoredStrategyCalibration | null) {
  if (!calibration || calibration.resolvedDecisions < 1) return '';
  return [
    `STRATEGY CALIBRATION FROM REAL OUTCOMES (${calibration.resolvedDecisions} resolved decisions):`,
    `Average forecast accuracy: ${calibration.averageForecastAccuracy}%.`,
    `Average realized outcome score: ${calibration.averageOutcomeScore}%.`,
    `Assumption hit rate: ${calibration.assumptionHitRate}%.`,
    `Dimension forecast accuracies: strategic fit ${calibration.dimensions.strategicFit}%, expected value ${calibration.dimensions.expectedValue}%, downside ${calibration.dimensions.downsideRisk}%, reversibility ${calibration.dimensions.reversibility}%, execution complexity ${calibration.dimensions.executionComplexity}%, evidence strength ${calibration.dimensions.evidenceStrength}%, relationship impact ${calibration.dimensions.relationshipImpact}%.`,
    calibration.recurringLessons.length ? `Recurring lessons: ${calibration.recurringLessons.join(' | ')}` : '',
    'Treat weak historical dimensions with more skepticism; calibration changes emphasis, never facts.',
  ].filter(Boolean).join('\n');
}
