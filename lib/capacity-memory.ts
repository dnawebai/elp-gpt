import { Honcho } from '@honcho-ai/sdk';

export type CapacityStatus = 'balanced' | 'tight' | 'overloaded' | 'critical';
export type AllocationAction = 'accelerate' | 'protect' | 'resolve' | 'delegate' | 'defer' | 'stop';

export type CapacityProfile = {
  weeklyHours: number;
  reservePercent: number;
  adminPercent: number;
  maxConcurrentObjectives: number;
  defaultTaskHours: number;
  timezone: string;
  updatedAt: string;
};

export type CalendarCapacity = {
  available: boolean;
  source?: string;
  horizonDays: number;
  eventCount: number;
  busyHours: number;
  allDayEvents: number;
  note?: string;
};

export type CapacityDemand = {
  id: string;
  source: 'task' | 'goal' | 'commitment' | 'delegation';
  sourceId: string;
  title: string;
  owner?: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  dueDate?: string;
  estimatedHours: number;
  reason: string;
  goalId?: string;
};

export type AllocationRecommendation = {
  id: string;
  action: AllocationAction;
  source: CapacityDemand['source'] | 'portfolio' | 'calendar';
  sourceId: string;
  title: string;
  reason: string;
  estimatedHoursRecovered?: number;
  confidence: number;
  requiresApproval: boolean;
};

export type CapacityPlan = {
  id: string;
  generatedAt: string;
  profile: CapacityProfile;
  calendar: CalendarCapacity;
  status: CapacityStatus;
  grossCapacityHours: number;
  reserveHours: number;
  adminHours: number;
  calendarBusyHours: number;
  executionCapacityHours: number;
  estimatedDemandHours: number;
  capacityGapHours: number;
  loadRatio: number;
  demand: CapacityDemand[];
  recommendations: AllocationRecommendation[];
  stats: {
    activeGoals: number;
    criticalGoals: number;
    atRiskGoals: number;
    openCommitments: number;
    activeTasks: number;
    delegatedOpen: number;
    delegationExceptions: number;
    orphanTasks: number;
  };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`capacity-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

export function defaultCapacityProfile(): CapacityProfile {
  return {
    weeklyHours: 45,
    reservePercent: 20,
    adminPercent: 12,
    maxConcurrentObjectives: 5,
    defaultTaskHours: 3,
    timezone: process.env.ELP_BRIEFING_TIMEZONE || 'America/Toronto',
    updatedAt: new Date().toISOString(),
  };
}

function parseProfile(metadata: Record<string, unknown>): CapacityProfile | null {
  if (metadata.jarbisCapacityProfile !== true || typeof metadata.profileJson !== 'string') return null;
  try {
    const raw = JSON.parse(metadata.profileJson) as Partial<CapacityProfile>;
    const base = defaultCapacityProfile();
    return {
      weeklyHours: Math.max(1, Math.min(120, Number(raw.weeklyHours) || base.weeklyHours)),
      reservePercent: Math.max(0, Math.min(60, Number(raw.reservePercent) || 0)),
      adminPercent: Math.max(0, Math.min(50, Number(raw.adminPercent) || 0)),
      maxConcurrentObjectives: Math.max(1, Math.min(20, Math.round(Number(raw.maxConcurrentObjectives) || base.maxConcurrentObjectives))),
      defaultTaskHours: Math.max(0.25, Math.min(40, Number(raw.defaultTaskHours) || base.defaultTaskHours)),
      timezone: typeof raw.timezone === 'string' && raw.timezone.trim() ? raw.timezone.trim().slice(0, 80) : base.timezone,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    };
  } catch { return null; }
}

function parsePlan(metadata: Record<string, unknown>): CapacityPlan | null {
  if (metadata.jarbisCapacityPlan !== true || typeof metadata.planJson !== 'string') return null;
  try {
    const plan = JSON.parse(metadata.planJson) as CapacityPlan;
    return plan && typeof plan.id === 'string' && Array.isArray(plan.demand) && Array.isArray(plan.recommendations) ? plan : null;
  } catch { return null; }
}

export async function getCapacityProfile(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return defaultCapacityProfile();
  try {
    const page = await handles.session.messages({ size: 60, reverse: true });
    return page.items.map((item) => parseProfile(item.metadata || {})).find((item): item is CapacityProfile => Boolean(item)) || defaultCapacityProfile();
  } catch {
    return defaultCapacityProfile();
  }
}

export async function saveCapacityProfile(profileId: string, patch: Partial<Omit<CapacityProfile, 'updatedAt'>>) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Capacity memory is unavailable.');
  const current = await getCapacityProfile(profileId);
  const next: CapacityProfile = {
    weeklyHours: Math.max(1, Math.min(120, Number(patch.weeklyHours ?? current.weeklyHours))),
    reservePercent: Math.max(0, Math.min(60, Number(patch.reservePercent ?? current.reservePercent))),
    adminPercent: Math.max(0, Math.min(50, Number(patch.adminPercent ?? current.adminPercent))),
    maxConcurrentObjectives: Math.max(1, Math.min(20, Math.round(Number(patch.maxConcurrentObjectives ?? current.maxConcurrentObjectives)))),
    defaultTaskHours: Math.max(0.25, Math.min(40, Number(patch.defaultTaskHours ?? current.defaultTaskHours))),
    timezone: typeof patch.timezone === 'string' && patch.timezone.trim() ? patch.timezone.trim().slice(0, 80) : current.timezone,
    updatedAt: new Date().toISOString(),
  };
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[CAPACITY_PROFILE] ${next.updatedAt}`, metadata: { jarbisCapacityProfile: true, recordVersion: 1, profileJson: JSON.stringify(next) } }]);
  return next;
}

export async function persistCapacityPlan(profileId: string, plan: CapacityPlan) {
  const handles = await getSession(profileId);
  if (!handles) return plan;
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[CAPACITY_PLAN][${plan.status.toUpperCase()}] ${plan.generatedAt}\nDemand ${plan.estimatedDemandHours}h / execution capacity ${plan.executionCapacityHours}h.`, metadata: { jarbisCapacityPlan: true, recordVersion: 1, planId: plan.id, generatedAt: plan.generatedAt, status: plan.status, loadRatio: plan.loadRatio, planJson: JSON.stringify(plan) } }]);
  return plan;
}

export async function getLatestCapacityPlan(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return null;
  try {
    const page = await handles.session.messages({ size: 60, reverse: true });
    return page.items.map((item) => parsePlan(item.metadata || {})).find((item): item is CapacityPlan => Boolean(item)) || null;
  } catch { return null; }
}

export function capacityPlanToPrompt(plan: CapacityPlan | null) {
  if (!plan) return '';
  const top = plan.recommendations.slice(0, 6).map((item) => `- [${item.action.toUpperCase()}] ${item.title}: ${item.reason}`);
  return [
    `RESOURCE CAPACITY: ${plan.status.toUpperCase()}. Estimated demand ${plan.estimatedDemandHours}h versus ${plan.executionCapacityHours}h execution capacity over ${plan.calendar.horizonDays} days; gap ${plan.capacityGapHours}h; load ${Math.round(plan.loadRatio * 100)}%.`,
    `Calendar: ${plan.calendar.available ? `${plan.calendar.eventCount} events, ${plan.calendar.busyHours} busy hours` : 'live calendar load unavailable'}.`,
    top.length ? `ALLOCATION RECOMMENDATIONS:\n${top.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
