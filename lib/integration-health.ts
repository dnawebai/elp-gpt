import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { getCommunicationsSyncSnapshot, runCommunicationsSync } from '@/lib/communications-sync';
import { CONNECTION_POLICIES, createConnectionLink, listConnectedAccounts, setConnectedAccountEnabled, type ConnectedAccountSummary } from '@/lib/connections';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import {
  classifyCommunicationsState,
  classifyConnection,
  classifyProviderHealth,
  healthScore,
  normalizeToolkit,
  type IntegrationHealthIssue,
} from '@/lib/integration-health-policy';
import { getSubscriptionLifecycleSnapshot, runSubscriptionLifecycle } from '@/lib/subscription-lifecycle';

export type IntegrationHealthSnapshot = {
  id: string;
  generatedAt: string;
  score: number;
  issues: IntegrationHealthIssue[];
  stats: {
    total: number;
    healthy: number;
    watch: number;
    degraded: number;
    broken: number;
    disabled: number;
    disconnected: number;
    providerLimited: number;
    automaticRepairs: number;
    reconnectRequired: number;
  };
};

export type IntegrationRepairResult = {
  kind: 'repaired' | 'reconnect' | 'manual' | 'noop';
  message: string;
  redirectUrl?: string;
  snapshot?: IntegrationHealthSnapshot;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`integration-health-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

function parseSnapshot(message: { metadata: Record<string, unknown> }): IntegrationHealthSnapshot | null {
  const metadata = message.metadata || {};
  if (metadata.elpIntegrationHealth !== true || typeof metadata.snapshotJson !== 'string') return null;
  try {
    const snapshot = JSON.parse(metadata.snapshotJson) as IntegrationHealthSnapshot;
    return snapshot && Array.isArray(snapshot.issues) ? snapshot : null;
  } catch { return null; }
}

async function persistSnapshot(profileId: string, snapshot: IntegrationHealthSnapshot) {
  const handles = await getSession(profileId);
  if (!handles) return snapshot;
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[INTEGRATION_HEALTH] ${snapshot.score}/100 · ${snapshot.stats.broken} broken · ${snapshot.stats.degraded} degraded · ${snapshot.stats.reconnectRequired} reconnect`,
    metadata: { elpIntegrationHealth: true, recordVersion: 1, generatedAt: snapshot.generatedAt, snapshotJson: JSON.stringify(snapshot) },
  }]);
  return snapshot;
}

export async function getLatestIntegrationHealth(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return null;
  try {
    const messages = await listHonchoMessages(handles.session, { pageSize: 50, maxPages: 8, reverse: true });
    for (const message of messages) {
      const snapshot = parseSnapshot(message);
      if (snapshot) return snapshot;
    }
    return null;
  } catch { return null; }
}

function issueId(issue: Omit<IntegrationHealthIssue, 'id'>) {
  return [issue.source, issue.toolkit, issue.accountId || 'default', issue.repairKind].join(':');
}

function withId(issue: Omit<IntegrationHealthIssue, 'id'>): IntegrationHealthIssue {
  return { id: issueId(issue), ...issue };
}

function expectedToolkits() {
  const base = CONNECTION_POLICIES.map((item) => ({ toolkit: normalizeToolkit(item.slug), label: item.label }));
  base.push({ toolkit: 'whatsapp', label: 'WhatsApp Business' });
  return base;
}

function accountMatchesToolkit(account: ConnectedAccountSummary, toolkit: string) {
  return normalizeToolkit(account.toolkit) === toolkit;
}

function statsFor(issues: IntegrationHealthIssue[]): IntegrationHealthSnapshot['stats'] {
  return {
    total: issues.length,
    healthy: issues.filter((item) => item.status === 'healthy').length,
    watch: issues.filter((item) => item.status === 'watch').length,
    degraded: issues.filter((item) => item.status === 'degraded').length,
    broken: issues.filter((item) => item.status === 'broken').length,
    disabled: issues.filter((item) => item.status === 'disabled').length,
    disconnected: issues.filter((item) => item.status === 'disconnected').length,
    providerLimited: issues.filter((item) => item.status === 'provider_limited').length,
    automaticRepairs: issues.filter((item) => item.repairKind === 'resync' || item.repairKind === 'renew').length,
    reconnectRequired: issues.filter((item) => item.repairKind === 'reconnect').length,
  };
}

function needsCommunicationsRecovery(snapshot: Awaited<ReturnType<typeof getCommunicationsSyncSnapshot>>) {
  const now = Date.now();
  return snapshot.states.some((state) => {
    if (state.lastError || !state.baselineComplete || !state.lastSuccessAt) return true;
    const last = Date.parse(state.lastSuccessAt);
    return !Number.isFinite(last) || now - last > 10 * 60_000;
  });
}

export async function runIntegrationHealth(args: { profileId: string; persist?: boolean; refreshProviders?: boolean }) {
  let communications = await getCommunicationsSyncSnapshot(args.profileId);
  let lifecycle = await getSubscriptionLifecycleSnapshot(args.profileId);

  if (args.refreshProviders) {
    if (needsCommunicationsRecovery(communications)) {
      await runCommunicationsSync({ profileId: args.profileId, persist: true }).catch(() => undefined);
      communications = await getCommunicationsSyncSnapshot(args.profileId);
    }
    lifecycle = await runSubscriptionLifecycle({ profileId: args.profileId, persist: true }).catch(() => lifecycle);
  } else if (!lifecycle) {
    lifecycle = await runSubscriptionLifecycle({ profileId: args.profileId, persist: true }).catch(() => null);
  }

  const accounts = await listConnectedAccounts(args.profileId).catch(() => [] as ConnectedAccountSummary[]);
  const issues: IntegrationHealthIssue[] = [];

  for (const account of accounts) issues.push(withId(classifyConnection(account)));

  for (const expected of expectedToolkits()) {
    if (accounts.some((account) => accountMatchesToolkit(account, expected.toolkit))) continue;
    issues.push(withId({
      toolkit: expected.toolkit,
      accountLabel: expected.label,
      status: 'disconnected',
      severity: 'info',
      issue: 'Not connected',
      detail: 'No account is currently connected. This is informational unless the capability is needed by your workflows.',
      repairKind: 'connect',
      repairLabel: 'Connect',
      source: 'coverage',
    }));
  }

  for (const provider of lifecycle?.providers || []) {
    issues.push(withId(classifyProviderHealth({
      provider: provider.provider,
      ...(provider.accountId ? { accountId: provider.accountId } : {}),
      accountLabel: provider.accountLabel,
      status: provider.status,
      mode: provider.mode,
      note: provider.note,
      lastSuccessAt: provider.lastSuccessAt,
    })));
  }

  for (const state of communications.states) {
    issues.push(withId(classifyCommunicationsState({
      provider: state.provider,
      ...(state.accountId ? { accountId: state.accountId } : {}),
      accountLabel: state.accountLabel,
      baselineComplete: state.baselineComplete,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
    })));
  }

  const rank = { critical: 4, high: 3, warning: 2, info: 1 } as const;
  issues.sort((a, b) => rank[b.severity] - rank[a.severity] || a.accountLabel.localeCompare(b.accountLabel));
  const snapshot: IntegrationHealthSnapshot = {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    score: healthScore(issues),
    issues,
    stats: statsFor(issues),
  };
  return args.persist === false ? snapshot : persistSnapshot(args.profileId, snapshot);
}

function toolkitForConnection(toolkit: string) {
  if (toolkit === 'google_calendar') return 'googlecalendar';
  if (toolkit === 'google_drive') return 'googledrive';
  if (toolkit === 'outlook') return 'microsoftoutlook';
  return toolkit;
}

export async function repairIntegrationIssue(args: { profileId: string; issueId: string; origin: string }) : Promise<IntegrationRepairResult> {
  let snapshot = await getLatestIntegrationHealth(args.profileId);
  if (!snapshot || !snapshot.issues.some((item) => item.id === args.issueId)) {
    snapshot = await runIntegrationHealth({ profileId: args.profileId, persist: true, refreshProviders: false });
  }
  const issue = snapshot.issues.find((item) => item.id === args.issueId);
  if (!issue) throw new Error('Integration issue is no longer present. Refresh health and try again.');

  if (issue.repairKind === 'none') return { kind: 'noop', message: 'This integration is already healthy.', snapshot };
  if (issue.repairKind === 'provider_boundary') {
    return { kind: 'manual', message: 'The connected provider does not expose the required subscription capability. ELP will keep the supported fallback or remain fail-closed.', snapshot };
  }
  if (issue.repairKind === 'configure') {
    return { kind: 'manual', message: issue.detail || 'Provider-side configuration is required before ELP can complete this repair.', snapshot };
  }
  if (issue.repairKind === 'enable') {
    if (!issue.accountId) throw new Error('No connected account is available to enable.');
    await setConnectedAccountEnabled(args.profileId, issue.accountId, true);
    const updated = await runIntegrationHealth({ profileId: args.profileId, persist: true, refreshProviders: true });
    return { kind: 'repaired', message: 'Connected account enabled and provider health re-checked.', snapshot: updated };
  }
  if (issue.repairKind === 'resync') {
    await runCommunicationsSync({ profileId: args.profileId, persist: true });
    await runSubscriptionLifecycle({ profileId: args.profileId, persist: true }).catch(() => undefined);
    const updated = await runIntegrationHealth({ profileId: args.profileId, persist: true, refreshProviders: false });
    return { kind: 'repaired', message: 'Incremental synchronization was restarted and health was re-checked.', snapshot: updated };
  }
  if (issue.repairKind === 'renew') {
    await runSubscriptionLifecycle({ profileId: args.profileId, persist: true });
    const updated = await runIntegrationHealth({ profileId: args.profileId, persist: true, refreshProviders: false });
    return { kind: 'repaired', message: 'Provider subscription lifecycle was renewed and re-checked.', snapshot: updated };
  }
  if (issue.repairKind === 'reconnect' || issue.repairKind === 'connect') {
    const toolkit = toolkitForConnection(issue.toolkit);
    const callbackUrl = `${args.origin.replace(/\/$/, '')}/connections?connected=${encodeURIComponent(toolkit)}&repair=1`;
    const link = await createConnectionLink({ profileId: args.profileId, toolkit, callbackUrl });
    return { kind: 'reconnect', message: 'Provider authorization is required to complete this repair.', redirectUrl: link.redirectUrl, snapshot };
  }
  return { kind: 'manual', message: 'No safe automatic repair is defined for this issue.', snapshot };
}
