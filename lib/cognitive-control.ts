import { getAnticipatorySnapshot } from '@/lib/anticipatory-chief-of-staff';
import { getCognitivePolicySnapshot } from '@/lib/cognitive-policy';
import { getCommitmentFulfilmentSnapshot } from '@/lib/commitment-fulfilment';
import { getStrategyCalibration, listDecisionOutcomes } from '@/lib/decision-learning';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getRadarSnapshot } from '@/lib/radar';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { listStrategicSimulations } from '@/lib/strategic-simulation';
import { getTaskBoard } from '@/lib/task-router';

export type AttentionItem = {
  id: string;
  source: 'anticipatory' | 'decision' | 'task' | 'commitment' | 'relationship' | 'radar';
  severity: 'critical' | 'high' | 'normal';
  title: string;
  reason: string;
  recommendedAction: string;
};

export type RecoveryPlay = {
  id: string;
  title: string;
  trigger: string;
  response: string;
  sourceIds: string[];
};

export type SkillProposal = {
  id: string;
  title: string;
  reason: string;
  capability: string;
  risk: 'read' | 'write' | 'high';
};

function clip(value: string, max = 1000) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function severityRank(value: AttentionItem['severity']) { return value === 'critical' ? 3 : value === 'high' ? 2 : 1; }

export async function getCognitiveControlSnapshot(profileId: string) {
  const [policy, outcomes, calibration, anticipatory, fulfilment, ledger, radar, relationships, tasks, simulations] = await Promise.all([
    getCognitivePolicySnapshot(profileId),
    listDecisionOutcomes(profileId),
    getStrategyCalibration(profileId),
    getAnticipatorySnapshot(profileId),
    getCommitmentFulfilmentSnapshot(profileId),
    getExecutiveLedger(profileId),
    getRadarSnapshot(profileId),
    getRelationshipSnapshot(profileId),
    getTaskBoard(profileId),
    listStrategicSimulations(profileId),
  ]);

  const attention: AttentionItem[] = [];
  for (const risk of anticipatory.risks.filter((item) => item.severity === 'critical' || item.severity === 'high').slice(0, 8)) {
    attention.push({ id: `forecast:${risk.id}`, source: 'anticipatory', severity: risk.severity === 'critical' ? 'critical' : 'high', title: risk.title, reason: risk.summary, recommendedAction: risk.recommendedAction });
  }
  for (const task of tasks.queues.decisions.filter((item) => item.status !== 'completed' && item.status !== 'cancelled').slice(0, 8)) {
    attention.push({ id: `task:${task.id}`, source: 'task', severity: task.priority === 'critical' ? 'critical' : task.priority === 'high' ? 'high' : 'normal', title: task.title, reason: task.summary || task.objective, recommendedAction: task.approval === 'required' ? 'Review the exact pending action and approve or reject it.' : 'Provide the missing decision or input.' });
  }
  for (const record of outcomes.filter((item) => item.status === 'mixed' || item.status === 'failed' || item.assumptions.some((a) => a.status === 'contradicted')).slice(0, 8)) {
    attention.push({ id: `outcome:${record.id}`, source: 'decision', severity: record.status === 'failed' ? 'critical' : 'high', title: `Decision outcome: ${record.decision}`, reason: record.summary, recommendedAction: record.nextActions[0] || 'Review contradicted assumptions and choose whether to reverse, adapt, or continue.' });
  }
  for (const record of fulfilment.records.filter((item) => item.status === 'approval_required' || item.status === 'needs_input' || item.status === 'blocked').slice(0, 8)) {
    attention.push({ id: `fulfilment:${record.id}`, source: 'commitment', severity: record.status === 'blocked' ? 'high' : 'normal', title: record.title, reason: record.summary, recommendedAction: record.question || 'Resolve the blocker or review the pending approval.' });
  }
  for (const relation of relationships.relationships.filter((item) => item.strategicValue === 'critical' && (item.momentum === 'stalled' || item.momentum === 'cooling')).slice(0, 5)) {
    attention.push({ id: `relationship:${relation.id}`, source: 'relationship', severity: relation.momentum === 'stalled' ? 'high' : 'normal', title: `Relationship: ${relation.name}`, reason: `${relation.name}${relation.organization ? ` — ${relation.organization}` : ''} is ${relation.momentum}.`, recommendedAction: relation.nextBestAction || 'Review open loops and prepare a follow-up.' });
  }
  for (const signal of radar.signals.filter((item) => item.status === 'open' && (item.severity === 'critical' || item.severity === 'high')).slice(0, 5)) {
    attention.push({ id: `radar:${signal.id}`, source: 'radar', severity: signal.severity === 'critical' ? 'critical' : 'high', title: signal.title, reason: signal.summary, recommendedAction: signal.recommendedAction });
  }
  attention.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const contradictedAssumptions = outcomes.flatMap((item) => item.assumptions.filter((a) => a.status === 'contradicted').map((a) => ({ ...a, decision: item.decision, outcomeId: item.id }))).slice(0, 20);
  const openAssumptions = outcomes.flatMap((item) => item.assumptions.filter((a) => a.status === 'open' || a.status === 'unknown').map((a) => ({ ...a, decision: item.decision, outcomeId: item.id }))).slice(0, 30);

  const recoveryPlays: RecoveryPlay[] = [];
  for (const outcome of outcomes.filter((item) => item.status === 'failed' || item.status === 'mixed').slice(0, 8)) {
    recoveryPlays.push({ id: `decision:${outcome.id}`, title: `Recover: ${clip(outcome.decision, 120)}`, trigger: outcome.summary, response: outcome.nextActions[0] || outcome.lessons[0] || 'Re-run the decision with new evidence, preserve reversibility, and explicitly test the contradicted assumption.', sourceIds: [outcome.id, outcome.simulationId] });
  }
  for (const risk of anticipatory.risks.filter((item) => item.severity === 'critical').slice(0, 5)) {
    recoveryPlays.push({ id: `risk:${risk.id}`, title: `Contingency: ${risk.title}`, trigger: risk.summary, response: risk.recommendedAction, sourceIds: [risk.id, ...risk.relatedIds] });
  }

  const skillProposals: SkillProposal[] = [];
  const gapText = [
    ...attention.map((item) => `${item.title} ${item.reason}`),
    ...outcomes.flatMap((item) => item.nextActions),
  ].join(' ').toLowerCase();
  if (/manual|repetitive|copy|spreadsheet|reconcile/.test(gapText)) skillProposals.push({ id: 'workflow-automation', title: 'Workflow Automation Skill', reason: 'Repeated manual/reconciliation work appears in current obligations.', capability: 'Turn recurring read/prepare/reconcile sequences into a reusable bounded workflow with explicit write approval.', risk: 'write' });
  if (/research|verify|evidence|unknown|assumption/.test(gapText)) skillProposals.push({ id: 'evidence-research', title: 'Evidence Verification Skill', reason: 'Open assumptions and verification work are materially affecting decisions.', capability: 'Run a source-tracked research protocol that records claims, contrary evidence, provenance, and confidence.', risk: 'read' });
  if (/follow-up|relationship|stalled|reply/.test(gapText)) skillProposals.push({ id: 'relationship-recovery', title: 'Relationship Recovery Skill', reason: 'Relationship follow-ups or stalled threads recur in current work.', capability: 'Prepare context-aware follow-up options, escalation timing, and recovery sequences while keeping sends approval-gated.', risk: 'write' });
  if (/deadline|overdue|blocked|dependency/.test(gapText)) skillProposals.push({ id: 'dependency-control', title: 'Dependency Control Skill', reason: 'Deadline/dependency pressure appears in the active workload.', capability: 'Map dependency owners, latest safe intervention points, fallbacks, and escalation conditions.', risk: 'read' });

  const totalUncertainty = openAssumptions.length + policy.evidence.filter((item) => item.status === 'unverified').length + anticipatory.risks.filter((item) => item.confidence < 0.7).length;
  const criticalAttention = attention.filter((item) => item.severity === 'critical').length;
  const highAttention = attention.filter((item) => item.severity === 'high').length;

  return {
    generatedAt: new Date().toISOString(),
    policy,
    calibration,
    attention: attention.slice(0, 30),
    assumptions: { contradicted: contradictedAssumptions, open: openAssumptions },
    uncertainty: {
      totalOpenSignals: totalUncertainty,
      openAssumptions: openAssumptions.length,
      unverifiedEvidence: policy.evidence.filter((item) => item.status === 'unverified').length,
      lowConfidenceForecasts: anticipatory.risks.filter((item) => item.confidence < 0.7).length,
      level: totalUncertainty >= 16 ? 'high' : totalUncertainty >= 7 ? 'medium' : 'low',
    },
    recoveryPlays,
    skillProposals,
    stats: {
      strategicSimulations: simulations.length,
      trackedDecisions: outcomes.length,
      resolvedDecisions: calibration.resolvedDecisions,
      activeLedgerItems: ledger.items.filter((item) => item.status === 'active' || item.status === 'blocked').length,
      criticalAttention,
      highAttention,
      approvalRequired: fulfilment.records.filter((item) => item.status === 'approval_required').length,
    },
  };
}
