import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import type { ActionRisk } from '@/lib/actions';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type StandingAuthorityPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  principalId: string;
  allowedToolSlugs: string[];
  allowedConnectedAccountIds: string[];
  maxRisk: 'write' | 'high';
  allowHighRisk: boolean;
  maxActionsPerDay: number;
  maxAmount?: number;
  currency?: string;
  recipientDomains: string[];
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  createdByPrincipalId: string;
};

export type StandingAuthorityState = {
  killSwitch: boolean;
  killSwitchUpdatedAt?: string;
  policies: StandingAuthorityPolicy[];
};

type Usage = { id: string; policyId: string; principalId: string; toolSlug: string; createdAt: string; digest?: string };

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
async function sessionFor(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`); const elp = await honcho.peer('elp');
  const session = await honcho.session(`standing-authority-${profileId}`); await session.addPeers([user, elp]);
  return { user, elp, session };
}
function parsePolicy(m: { metadata: Record<string, unknown> }) {
  if (m.metadata?.elpStandingAuthorityPolicy !== true || typeof m.metadata.policyJson !== 'string') return null;
  try { const p = JSON.parse(m.metadata.policyJson) as StandingAuthorityPolicy; return p?.id && p.name ? p : null; } catch { return null; }
}
function parseUsage(m: { metadata: Record<string, unknown> }) {
  if (m.metadata?.elpStandingAuthorityUsage !== true || typeof m.metadata.usageJson !== 'string') return null;
  try { return JSON.parse(m.metadata.usageJson) as Usage; } catch { return null; }
}
function normSlug(value: string) { return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 160); }
function amountFromArgs(args: Record<string, unknown>) {
  const keys = ['amount','total','price','value','cost','payment_amount','charge_amount'];
  for (const key of keys) { const n = Number(args[key]); if (Number.isFinite(n) && n >= 0) return n; }
  return null;
}
function currencyFromArgs(args: Record<string, unknown>) {
  for (const key of ['currency','currency_code','currencyCode']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase().slice(0, 8);
  }
  return null;
}
function recipientDomains(args: Record<string, unknown>) {
  const text = [args.to,args.recipient,args.email,args.recipients].flatMap((v) => Array.isArray(v) ? v : [v]).filter((v): v is string => typeof v === 'string').join(',');
  return [...text.matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase());
}

export async function getStandingAuthorityState(profileId: string): Promise<StandingAuthorityState> {
  const h = await sessionFor(profileId); if (!h) return { killSwitch: true, policies: [] };
  const messages = await listHonchoMessages(h.session, { pageSize: 100, maxPages: 20, reverse: true });
  const policies = new Map<string, StandingAuthorityPolicy>(); let killSwitch = false; let killSwitchUpdatedAt: string | undefined;
  for (const m of messages) {
    if (m.metadata?.elpStandingAuthorityKillSwitch === true && killSwitchUpdatedAt === undefined) { killSwitch = m.metadata.enabled === true; killSwitchUpdatedAt = typeof m.metadata.updatedAt === 'string' ? m.metadata.updatedAt : m.createdAt; }
    const p = parsePolicy(m); if (p && !policies.has(p.id)) policies.set(p.id, p);
  }
  return { killSwitch, killSwitchUpdatedAt, policies: [...policies.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)) };
}

export async function saveStandingAuthorityPolicy(profileId: string, actorPrincipalId: string, input: Partial<StandingAuthorityPolicy> & { name: string; principalId: string; allowedToolSlugs: string[] }) {
  const h = await sessionFor(profileId); if (!h) throw new Error('Standing authority storage is unavailable.');
  const current = input.id ? (await getStandingAuthorityState(profileId)).policies.find((p)=>p.id===input.id) : undefined;
  const now = new Date().toISOString();
  const slugs = [...new Set(input.allowedToolSlugs.map(normSlug).filter(Boolean))].slice(0, 40); if (!slugs.length) throw new Error('At least one exact tool slug is required.');
  const maxRisk = input.maxRisk === 'high' ? 'high' : 'write';
  const policy: StandingAuthorityPolicy = {
    id: current?.id || randomUUID(), name: input.name.trim().slice(0,120), enabled: input.enabled !== false,
    principalId: input.principalId.trim().slice(0,160), allowedToolSlugs: slugs,
    allowedConnectedAccountIds: [...new Set((input.allowedConnectedAccountIds || []).map((x)=>String(x).trim().slice(0,180)).filter(Boolean))].slice(0,30),
    maxRisk, allowHighRisk: maxRisk === 'high' && input.allowHighRisk === true,
    maxActionsPerDay: Math.max(1, Math.min(500, Math.round(Number(input.maxActionsPerDay || 25)))),
    ...(Number.isFinite(Number(input.maxAmount)) && Number(input.maxAmount) >= 0 ? { maxAmount: Number(input.maxAmount) } : {}),
    ...(typeof input.currency === 'string' && input.currency.trim() ? { currency: input.currency.trim().toUpperCase().slice(0,8) } : {}),
    recipientDomains: [...new Set((input.recipientDomains || []).map((x)=>String(x).trim().toLowerCase().replace(/^@/,'')).filter(Boolean))].slice(0,40),
    ...(input.expiresAt && Number.isFinite(Date.parse(input.expiresAt)) ? { expiresAt: new Date(input.expiresAt).toISOString() } : {}),
    createdAt: current?.createdAt || now, updatedAt: now, createdByPrincipalId: current?.createdByPrincipalId || actorPrincipalId,
  };
  if (!policy.name || !policy.principalId) throw new Error('Policy name and principal are required.');
  if (policy.maxAmount !== undefined && !policy.currency) throw new Error('A currency is required when a maximum amount is configured.');
  await h.session.addMessages([{ peerId: h.user.id, content: `[STANDING_AUTHORITY] ${policy.name}`, metadata: { elpStandingAuthorityPolicy: true, recordVersion: 1, policyId: policy.id, policyJson: JSON.stringify(policy) } }]);
  return policy;
}

export async function setStandingAuthorityKillSwitch(profileId: string, actorPrincipalId: string, enabled: boolean) {
  const h = await sessionFor(profileId); if (!h) throw new Error('Standing authority storage is unavailable.');
  const updatedAt = new Date().toISOString();
  await h.session.addMessages([{ peerId: h.user.id, content: `[STANDING_AUTHORITY_KILL_SWITCH] ${enabled ? 'ON' : 'OFF'}`, metadata: { elpStandingAuthorityKillSwitch: true, recordVersion: 1, enabled, actorPrincipalId, updatedAt } }]);
  return { enabled, updatedAt };
}

export async function evaluateStandingAuthority(args: { profileId: string; principalId: string; toolSlug: string; arguments: Record<string, unknown>; risk: ActionRisk; connectedAccountId?: string }) {
  if (args.risk === 'read') return { allowed: true, reason: 'Read-only action.', policy: null as StandingAuthorityPolicy | null };
  const state = await getStandingAuthorityState(args.profileId); if (state.killSwitch) return { allowed: false, reason: 'Standing authority kill switch is active.', policy: null };
  const now = Date.now(); const slug = normSlug(args.toolSlug);
  const candidates = state.policies.filter((p)=>p.enabled && p.principalId===args.principalId && p.allowedToolSlugs.includes(slug) && (!p.expiresAt || Date.parse(p.expiresAt)>now));
  for (const p of candidates) {
    if (args.risk === 'high' && (!p.allowHighRisk || p.maxRisk !== 'high')) continue;
    if (p.allowedConnectedAccountIds.length && (!args.connectedAccountId || !p.allowedConnectedAccountIds.includes(args.connectedAccountId))) continue;
    const domains = recipientDomains(args.arguments);
    if (p.recipientDomains.length && (!domains.length || domains.some((d)=>!p.recipientDomains.includes(d)))) continue;
    const amount = amountFromArgs(args.arguments);
    if (p.maxAmount !== undefined && (amount === null || amount > p.maxAmount)) continue;
    const currency = currencyFromArgs(args.arguments);
    if (p.currency && (!currency || currency !== p.currency)) continue;
    const h = await sessionFor(args.profileId); if (!h) continue;
    const messages = await listHonchoMessages(h.session, { pageSize: 100, maxPages: 10, reverse: true });
    const day = new Date().toISOString().slice(0,10);
    const usages = messages.map(parseUsage).filter((u): u is Usage => u !== null);
    const used = usages.filter((u) => u.policyId === p.id && u.createdAt.startsWith(day)).length;
    if (used >= p.maxActionsPerDay) continue;
    return { allowed: true, reason: `Authorized by standing policy ${p.name}.`, policy: p };
  }
  return { allowed: false, reason: 'No active standing authority policy matches this exact action.', policy: null };
}

export async function recordStandingAuthorityUse(profileId: string, policy: StandingAuthorityPolicy, principalId: string, toolSlug: string, digest?: string) {
  const h = await sessionFor(profileId); if (!h) throw new Error('Standing authority storage is unavailable.');
  const usage: Usage = { id: randomUUID(), policyId: policy.id, principalId, toolSlug: normSlug(toolSlug), createdAt: new Date().toISOString(), ...(digest ? { digest } : {}) };
  await h.session.addMessages([{ peerId: h.elp.id, content: `[STANDING_AUTHORITY_USE] ${policy.name}: ${usage.toolSlug}`, metadata: { elpStandingAuthorityUsage: true, recordVersion: 1, usageJson: JSON.stringify(usage) } }]);
  return usage;
}
