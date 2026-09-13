import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { executeComposioTool } from '@/lib/composio';
import { getCommunicationsSyncSnapshot } from '@/lib/communications-sync';
import { listConnectedAccounts, type ConnectedAccountSummary } from '@/lib/connections';
import { createGoogleCalendarWatch, listEventSubscriptions } from '@/lib/event-fabric';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import { isFresh, shouldRenewCalendarWatch } from '@/lib/subscription-policy';

export type SubscriptionLifecycleProvider = 'google_calendar' | 'gmail' | 'outlook' | 'whatsapp' | 'slack';
export type SubscriptionLifecycleMode = 'native_push' | 'delta_sync' | 'blocked';
export type SubscriptionLifecycleStatus = 'active' | 'renewed' | 'healthy_fallback' | 'degraded' | 'pending_configuration' | 'blocked' | 'unavailable';

export type SubscriptionProviderHealth = {
  id: string;
  provider: SubscriptionLifecycleProvider;
  accountId?: string;
  accountLabel: string;
  mode: SubscriptionLifecycleMode;
  status: SubscriptionLifecycleStatus;
  lastCheckedAt: string;
  lastSuccessAt?: string;
  expiresAt?: string;
  action?: string;
  note: string;
};

export type SubscriptionLifecycleSnapshot = {
  id: string;
  generatedAt: string;
  providers: SubscriptionProviderHealth[];
  stats: {
    nativeActive: number;
    renewed: number;
    healthyFallbacks: number;
    degraded: number;
    blocked: number;
    unavailable: number;
  };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function publicBaseUrl() { return (process.env.ELP_PUBLIC_BASE_URL?.trim() || 'https://elpgpt.com').replace(/\/$/, ''); }
function normalizeToolkit(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function active(account: ConnectedAccountSummary) { return account.status.toUpperCase() === 'ACTIVE' && !account.disabled; }
function clip(value: string, max = 600) { const text = value.trim(); return text.length <= max ? text : `${text.slice(0, max)}…`; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`subscription-lifecycle-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

function parseSnapshot(message: { metadata: Record<string, unknown> }): SubscriptionLifecycleSnapshot | null {
  const metadata = message.metadata || {};
  if (metadata.elpSubscriptionLifecycle !== true || typeof metadata.snapshotJson !== 'string') return null;
  try {
    const snapshot = JSON.parse(metadata.snapshotJson) as SubscriptionLifecycleSnapshot;
    return snapshot && Array.isArray(snapshot.providers) ? snapshot : null;
  } catch { return null; }
}

async function persistSnapshot(profileId: string, snapshot: SubscriptionLifecycleSnapshot) {
  const handles = await getSession(profileId);
  if (!handles) return snapshot;
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[SUBSCRIPTION_LIFECYCLE] ${snapshot.generatedAt}\n${snapshot.stats.nativeActive} native active; ${snapshot.stats.healthyFallbacks} healthy fallbacks; ${snapshot.stats.degraded} degraded.`,
    metadata: { elpSubscriptionLifecycle: true, recordVersion: 1, generatedAt: snapshot.generatedAt, snapshotJson: JSON.stringify(snapshot) },
  }]);
  return snapshot;
}

export async function getSubscriptionLifecycleSnapshot(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return null;
  try {
    const messages = await listHonchoMessages(handles.session, { pageSize: 50, maxPages: 6, reverse: true });
    for (const message of messages) {
      const snapshot = parseSnapshot(message);
      if (snapshot) return snapshot;
    }
    return null;
  } catch { return null; }
}

function providerAccounts(accounts: ConnectedAccountSummary[], provider: 'gmail' | 'outlook' | 'whatsapp' | 'slack') {
  return accounts.filter((account) => {
    if (!active(account)) return false;
    const toolkit = normalizeToolkit(account.toolkit);
    if (provider === 'outlook') return toolkit === 'outlook' || toolkit === 'microsoftoutlook';
    return toolkit === provider;
  });
}

function findArray(value: unknown, keys: string[]): unknown[] {
  const queue: unknown[] = [value];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item)) { queue.push(...item); continue; }
    const record = item as Record<string, unknown>;
    for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
    queue.push(...Object.values(record));
  }
  return [];
}

async function calendarHealth(profileId: string, now: Date): Promise<SubscriptionProviderHealth> {
  const checked = now.toISOString();
  try {
    const subscriptions = await listEventSubscriptions(profileId);
    const current = subscriptions.find((item) => item.provider === 'google_calendar');
    if (!shouldRenewCalendarWatch({ status: current?.status, expiresAt: current?.expiresAt, now, renewalWindowHours: 24 })) {
      return { id: randomUUID(), provider: 'google_calendar', accountLabel: 'Google Calendar', mode: 'native_push', status: 'active', lastCheckedAt: checked, expiresAt: current?.expiresAt, lastSuccessAt: current?.updatedAt, note: 'Native Calendar push channel is active and outside the renewal window.' };
    }

    const replacement = await createGoogleCalendarWatch(profileId, `${publicBaseUrl()}/api/webhooks/google-calendar`);
    let cleanupNote = '';
    if (current?.status === 'active' && current.channelId && current.resourceId && current.channelId !== replacement.channelId) {
      try {
        await executeComposioTool({
          toolSlug: 'GOOGLECALENDAR_CHANNELS_STOP',
          arguments: { id: current.channelId, resourceId: current.resourceId, ...(current.token ? { token: current.token } : {}) },
          profileId,
        });
        cleanupNote = ' Previous channel stopped after replacement became active.';
      } catch (error) {
        cleanupNote = ` Replacement is active; previous-channel cleanup will retry later (${clip(error instanceof Error ? error.message : 'cleanup failed', 180)}).`;
      }
    }
    return { id: randomUUID(), provider: 'google_calendar', accountLabel: 'Google Calendar', mode: 'native_push', status: 'renewed', lastCheckedAt: checked, lastSuccessAt: checked, expiresAt: replacement.expiresAt, action: 'renewed', note: `Native Calendar push channel was created or renewed without an intentional monitoring gap.${cleanupNote}` };
  } catch (error) {
    return { id: randomUUID(), provider: 'google_calendar', accountLabel: 'Google Calendar', mode: 'native_push', status: 'degraded', lastCheckedAt: checked, note: `Calendar subscription lifecycle failed: ${clip(error instanceof Error ? error.message : 'unknown error')}` };
  }
}

function communicationsHealth(
  provider: 'gmail' | 'outlook',
  accounts: ConnectedAccountSummary[],
  states: Awaited<ReturnType<typeof getCommunicationsSyncSnapshot>>['states'],
  now: Date,
) {
  const checked = now.toISOString();
  const connected = providerAccounts(accounts, provider);
  if (!connected.length) {
    return [{ id: randomUUID(), provider, accountLabel: provider === 'gmail' ? 'Gmail' : 'Outlook', mode: 'delta_sync' as const, status: 'unavailable' as const, lastCheckedAt: checked, note: `No active ${provider === 'gmail' ? 'Gmail' : 'Outlook'} connection is available.` }];
  }
  return connected.map((account): SubscriptionProviderHealth => {
    const state = states.find((item) => item.provider === provider && (!item.accountId || item.accountId === account.id));
    const label = account.alias || account.label || (provider === 'gmail' ? 'Gmail' : 'Outlook');
    if (!state) return { id: randomUUID(), provider, accountId: account.id, accountLabel: label, mode: 'delta_sync', status: 'pending_configuration', lastCheckedAt: checked, note: 'Connection is active; incremental checkpoint initialization is pending the next communications sync.' };
    const fresh = !state.lastError && isFresh(state.lastSuccessAt, 10, now);
    return {
      id: randomUUID(), provider, accountId: account.id, accountLabel: label, mode: 'delta_sync', status: fresh ? 'healthy_fallback' : 'degraded', lastCheckedAt: checked,
      ...(state.lastSuccessAt ? { lastSuccessAt: state.lastSuccessAt } : {}),
      note: fresh ? `${provider === 'gmail' ? 'Gmail history' : 'Outlook delta'} checkpoint is healthy; native provider push is not exposed by the connected tool surface.` : state.lastError ? `Incremental sync is degraded: ${clip(state.lastError)}` : 'Incremental sync has not succeeded within the expected ten-minute health window.',
    };
  });
}

async function whatsappHealth(profileId: string, accounts: ConnectedAccountSummary[], now: Date) {
  const checked = now.toISOString();
  const connected = providerAccounts(accounts, 'whatsapp');
  if (!connected.length) return [{ id: randomUUID(), provider: 'whatsapp' as const, accountLabel: 'WhatsApp Business', mode: 'native_push' as const, status: 'unavailable' as const, lastCheckedAt: checked, note: 'No active WhatsApp Business connection is available.' }];
  const output: SubscriptionProviderHealth[] = [];
  for (const account of connected) {
    const label = account.alias || account.label || 'WhatsApp Business';
    try {
      const result = await executeComposioTool({ toolSlug: 'WHATSAPP_GET_SUBSCRIBED_APPS', arguments: {}, profileId, connectedAccountId: account.id });
      const subscribed = findArray(result, ['data', 'subscribed_apps', 'apps']);
      if (subscribed.length) {
        output.push({ id: randomUUID(), provider: 'whatsapp', accountId: account.id, accountLabel: label, mode: 'native_push', status: 'active', lastCheckedAt: checked, lastSuccessAt: checked, note: 'WhatsApp Business has an active native application webhook subscription.' });
        continue;
      }
      const verifyToken = process.env.ELP_WHATSAPP_VERIFY_TOKEN?.trim();
      const appSecret = process.env.ELP_WHATSAPP_APP_SECRET?.trim();
      if (verifyToken && appSecret) {
        await executeComposioTool({ toolSlug: 'WHATSAPP_SUBSCRIBE_APP', arguments: { verify_token: verifyToken, override_callback_uri: `${publicBaseUrl()}/api/webhooks/whatsapp` }, profileId, connectedAccountId: account.id });
        output.push({ id: randomUUID(), provider: 'whatsapp', accountId: account.id, accountLabel: label, mode: 'native_push', status: 'renewed', lastCheckedAt: checked, lastSuccessAt: checked, action: 'subscribed', note: 'WhatsApp native webhook subscription was restored automatically.' });
      } else {
        output.push({ id: randomUUID(), provider: 'whatsapp', accountId: account.id, accountLabel: label, mode: 'native_push', status: 'pending_configuration', lastCheckedAt: checked, note: 'WhatsApp is connected, but direct ELP webhook activation remains fail-closed until webhook verification and signature validation configuration is present.' });
      }
    } catch (error) {
      output.push({ id: randomUUID(), provider: 'whatsapp', accountId: account.id, accountLabel: label, mode: 'native_push', status: 'degraded', lastCheckedAt: checked, note: `WhatsApp subscription health check failed: ${clip(error instanceof Error ? error.message : 'unknown error')}` });
    }
  }
  return output;
}

function slackHealth(accounts: ConnectedAccountSummary[], now: Date): SubscriptionProviderHealth[] {
  const checked = now.toISOString();
  const connected = providerAccounts(accounts, 'slack');
  if (!connected.length) return [{ id: randomUUID(), provider: 'slack', accountLabel: 'Slack', mode: 'blocked', status: 'unavailable', lastCheckedAt: checked, note: 'No active Slack connection is available.' }];
  return connected.map((account) => ({ id: randomUUID(), provider: 'slack', accountId: account.id, accountLabel: account.alias || account.label || 'Slack', mode: 'blocked', status: 'blocked', lastCheckedAt: checked, note: 'Slack is connected, but the active tool surface does not expose Events API subscription creation. ELP will not fabricate or bypass that provider boundary.' }));
}

function summarize(providers: SubscriptionProviderHealth[]): SubscriptionLifecycleSnapshot['stats'] {
  return {
    nativeActive: providers.filter((item) => item.mode === 'native_push' && (item.status === 'active' || item.status === 'renewed')).length,
    renewed: providers.filter((item) => item.status === 'renewed').length,
    healthyFallbacks: providers.filter((item) => item.status === 'healthy_fallback').length,
    degraded: providers.filter((item) => item.status === 'degraded' || item.status === 'pending_configuration').length,
    blocked: providers.filter((item) => item.status === 'blocked').length,
    unavailable: providers.filter((item) => item.status === 'unavailable').length,
  };
}

export async function runSubscriptionLifecycle(args: { profileId: string; persist?: boolean; now?: Date }) {
  const now = args.now || new Date();
  const [accounts, communications] = await Promise.all([
    listConnectedAccounts(args.profileId).catch(() => [] as ConnectedAccountSummary[]),
    getCommunicationsSyncSnapshot(args.profileId),
  ]);
  const calendar = await calendarHealth(args.profileId, now);
  const gmail = communicationsHealth('gmail', accounts, communications.states, now);
  const outlook = communicationsHealth('outlook', accounts, communications.states, now);
  const whatsapp = await whatsappHealth(args.profileId, accounts, now);
  const slack = slackHealth(accounts, now);
  const providers = [calendar, ...gmail, ...outlook, ...whatsapp, ...slack];
  const snapshot: SubscriptionLifecycleSnapshot = { id: randomUUID(), generatedAt: now.toISOString(), providers, stats: summarize(providers) };
  return args.persist === false ? snapshot : persistSnapshot(args.profileId, snapshot);
}
