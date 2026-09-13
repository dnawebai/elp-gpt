import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type PriorityHorizon = 'now' | 'today' | 'week';
export type PrioritySource = 'task' | 'goal' | 'commitment' | 'delegation' | 'relationship' | 'risk' | 'capacity' | 'notification';

export type PriorityItem = {
  id: string;
  source: PrioritySource;
  sourceId: string;
  title: string;
  horizon: PriorityHorizon;
  score: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  owner?: string;
  dueDate?: string;
  blocked: boolean;
  approvalRequired: boolean;
  reasons: string[];
  recommendedAction: string;
};

export type DailyOperatingPlan = {
  id: string;
  generatedAt: string;
  timezone: string;
  capacityStatus: 'balanced' | 'tight' | 'overloaded' | 'critical' | 'unknown';
  headline: string;
  focus: PriorityItem[];
  now: PriorityItem[];
  today: PriorityItem[];
  week: PriorityItem[];
  defer: PriorityItem[];
  stopDoing: PriorityItem[];
  blockers: PriorityItem[];
  stats: {
    totalCandidates: number;
    critical: number;
    blocked: number;
    decisions: number;
    relationshipItems: number;
    overload: boolean;
  };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`daily-plan-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

function parsePlan(metadata: Record<string, unknown>): DailyOperatingPlan | null {
  if (metadata.jarbisDailyOperatingPlan !== true || typeof metadata.planJson !== 'string') return null;
  try {
    const plan = JSON.parse(metadata.planJson) as DailyOperatingPlan;
    return plan && typeof plan.id === 'string' && Array.isArray(plan.focus) ? plan : null;
  } catch { return null; }
}

export async function persistDailyOperatingPlan(profileId: string, plan: DailyOperatingPlan) {
  const handles = await getSession(profileId);
  if (!handles) return plan;
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[DAILY_OPERATING_PLAN] ${plan.generatedAt}\n${plan.headline}`, metadata: { jarbisDailyOperatingPlan: true, recordVersion: 1, planId: plan.id, generatedAt: plan.generatedAt, capacityStatus: plan.capacityStatus, planJson: JSON.stringify(plan) } }]);
  return plan;
}

export async function listDailyOperatingPlans(profileId: string, limit = 100) {
  const handles = await getSession(profileId);
  if (!handles) return [] as DailyOperatingPlan[];
  try {
    const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: Math.ceil(Math.max(1, Math.min(limit, 2000)) / 100), reverse: true });
    return messages.map((item) => parsePlan(item.metadata || {})).filter((item): item is DailyOperatingPlan => Boolean(item)).slice(0, limit);
  } catch {
    return [] as DailyOperatingPlan[];
  }
}

export async function getLatestDailyOperatingPlan(profileId: string) {
  const plans = await listDailyOperatingPlans(profileId, 1);
  return plans[0] || null;
}

export function dailyOperatingPlanToPrompt(plan: DailyOperatingPlan | null) {
  if (!plan) return '';
  const lines = plan.focus.slice(0, 8).map((item, index) => `${index + 1}. [${item.horizon.toUpperCase()}][${item.score}] ${item.title} — ${item.recommendedAction}`);
  return [`DAILY OPERATING PLAN: ${plan.headline}`, ...lines].join('\n');
}
