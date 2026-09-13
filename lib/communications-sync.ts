import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { executeComposioTool, getComposioIdentityHealth } from '@/lib/composio';
import { listConnectedAccounts, type ConnectedAccountSummary } from '@/lib/connections';
import { recordInboundEvent } from '@/lib/event-fabric';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import { runInterruptManager } from '@/lib/interrupt-manager';
import { refreshNotifications } from '@/lib/notifications';

export type CommunicationsProvider = 'gmail' | 'outlook';

type PendingGmailMessage = { id: string; labels: string[] };

export type CommunicationsSyncState = {
  id: string;
  provider: CommunicationsProvider;
  accountId?: string;
  accountLabel: string;
  initialized: boolean;
  baselineComplete: boolean;
  cursor?: string;
  pageToken?: string;
  targetCursor?: string;
  pendingGmail: PendingGmailMessage[];
  processedEvents: number;
  lastSuccessAt?: string;
  lastAttemptAt: string;
  lastError?: string;
};

export type CommunicationsProviderResult = {
  provider: CommunicationsProvider;
  accountId?: string;
  accountLabel: string;
  status: 'baseline' | 'synced' | 'degraded' | 'unavailable';
  newEvents: number;
  processed: number;
  note?: string;
};

export type CommunicationsSyncRun = {
  id: string;
  generatedAt: string;
  results: CommunicationsProviderResult[];
  newEvents: number;
  degraded: number;
};

export type CommunicationsSyncSnapshot = {
  configured: boolean;
  generatedAt: string;
  states: CommunicationsSyncState[];
  latestRun: CommunicationsSyncRun | null;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`communications-sync-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

function stateKey(provider: CommunicationsProvider, accountId?: string) { return `${provider}:${accountId || 'default'}`; }

function parseState(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): CommunicationsSyncState | null {
  const m = message.metadata || {};
  if (m.elpCommunicationsSyncState !== true || typeof m.stateJson !== 'string') return null;
  try {
    const state = JSON.parse(m.stateJson) as CommunicationsSyncState;
    if (!state || !['gmail', 'outlook'].includes(state.provider) || typeof state.accountLabel !== 'string') return null;
    return { ...state, id: state.id || message.id, pendingGmail: Array.isArray(state.pendingGmail) ? state.pendingGmail : [] };
  } catch { return null; }
}

function parseRun(message: { metadata: Record<string, unknown> }): CommunicationsSyncRun | null {
  const m = message.metadata || {};
  if (m.elpCommunicationsSyncRun !== true || typeof m.runJson !== 'string') return null;
  try { const run = JSON.parse(m.runJson) as CommunicationsSyncRun; return run && Array.isArray(run.results) ? run : null; } catch { return null; }
}

async function loadRecords(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return { handles: null, states: [] as CommunicationsSyncState[], latestRun: null as CommunicationsSyncRun | null };
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const states = new Map<string, CommunicationsSyncState>();
  let latestRun: CommunicationsSyncRun | null = null;
  for (const message of messages) {
    if (!latestRun) latestRun = parseRun(message);
    const state = parseState(message);
    if (state) {
      const key = stateKey(state.provider, state.accountId);
      if (!states.has(key)) states.set(key, state);
    }
  }
  return { handles, states: [...states.values()], latestRun };
}

async function persistState(profileId: string, state: CommunicationsSyncState) {
  const handles = await getSession(profileId);
  if (!handles) return state;
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[COMMUNICATIONS_SYNC][${state.provider}] ${state.accountLabel}: ${state.lastError ? 'degraded' : state.baselineComplete ? 'synced' : 'baseline'}`, metadata: { elpCommunicationsSyncState: true, recordVersion: 1, provider: state.provider, accountId: state.accountId || '', lastAttemptAt: state.lastAttemptAt, stateJson: JSON.stringify(state) } }]);
  return state;
}

async function persistRun(profileId: string, run: CommunicationsSyncRun) {
  const handles = await getSession(profileId);
  if (!handles) return run;
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[COMMUNICATIONS_RUN] ${run.generatedAt}\n${run.newEvents} new events; ${run.degraded} degraded providers.`, metadata: { elpCommunicationsSyncRun: true, recordVersion: 1, generatedAt: run.generatedAt, runJson: JSON.stringify(run) } }]);
  return run;
}

function objects(value: unknown) {
  const result: Record<string, unknown>[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    const record = item as Record<string, unknown>;
    result.push(record);
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return result;
}

function firstString(value: unknown, keys: string[]) {
  for (const record of objects(value)) for (const key of keys) if (typeof record[key] === 'string' && String(record[key]).trim()) return String(record[key]);
  return '';
}

function findArray(value: unknown, key: string) {
  for (const record of objects(value)) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [] as unknown[];
}

function normalizeToolkit(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function isActive(account: ConnectedAccountSummary) { return account.status.toUpperCase() === 'ACTIVE' && !account.disabled; }

async function providerAccounts(profileId: string, provider: CommunicationsProvider) {
  const listed = await listConnectedAccounts(profileId).catch(() => [] as ConnectedAccountSummary[]);
  const matches = listed.filter((account) => {
    if (!isActive(account)) return false;
    const toolkit = normalizeToolkit(account.toolkit);
    return provider === 'gmail' ? toolkit === 'gmail' : toolkit === 'outlook' || toolkit === 'microsoftoutlook';
  });
  if (matches.length) return matches.map((account) => ({ id: account.id, label: account.alias || account.label || provider }));
  const health = getComposioIdentityHealth();
  const bound = new Set(health.boundToolkits.map((item) => normalizeToolkit(item)));
  if (provider === 'gmail' && bound.has('gmail')) return [{ id: undefined, label: 'Gmail' }];
  if (provider === 'outlook' && (bound.has('outlook') || bound.has('microsoftoutlook'))) return [{ id: undefined, label: 'Outlook' }];
  return [] as Array<{ id: string | undefined; label: string }>;
}

function newState(provider: CommunicationsProvider, account: { id?: string; label: string }): CommunicationsSyncState {
  return { id: randomUUID(), provider, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, initialized: false, baselineComplete: false, pendingGmail: [], processedEvents: 0, lastAttemptAt: new Date().toISOString() };
}

function headerMetadata(value: unknown) {
  const all = objects(value);
  const candidate = all.find((record) => typeof record.messageId === 'string' || (typeof record.subject === 'string' && typeof record.sender === 'string')) || {};
  const labels = Array.isArray(candidate.labelIds) ? candidate.labelIds.filter((item): item is string => typeof item === 'string') : [];
  return {
    id: typeof candidate.messageId === 'string' ? candidate.messageId : '',
    subject: typeof candidate.subject === 'string' ? clip(candidate.subject, 300) : '',
    sender: typeof candidate.sender === 'string' ? clip(candidate.sender, 300) : '',
    timestamp: typeof candidate.messageTimestamp === 'string' ? candidate.messageTimestamp : '',
    url: typeof candidate.display_url === 'string' ? candidate.display_url : '',
    labels,
  };
}

function gmailAdded(history: unknown[]) {
  const byId = new Map<string, PendingGmailMessage>();
  for (const raw of history) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const added = Array.isArray(entry.messagesAdded) ? entry.messagesAdded : [];
    for (const item of added) {
      if (!item || typeof item !== 'object') continue;
      const wrapper = item as Record<string, unknown>;
      const message = wrapper.message && typeof wrapper.message === 'object' ? wrapper.message as Record<string, unknown> : wrapper;
      const id = typeof message.id === 'string' ? message.id : '';
      const labels = Array.isArray(message.labelIds) ? message.labelIds.filter((label): label is string => typeof label === 'string') : [];
      if (!id || !labels.includes('INBOX') || labels.includes('SPAM') || labels.includes('TRASH') || labels.includes('CATEGORY_PROMOTIONS')) continue;
      byId.set(id, { id, labels });
    }
  }
  return [...byId.values()];
}

function recentEnough(timestamp: string, hours = 24) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && Date.now() - time <= hours * 3_600_000 && Date.now() - time >= -10 * 60_000;
}

async function syncGmail(profileId: string, account: { id?: string; label: string }, prior?: CommunicationsSyncState) {
  let state = prior ? { ...prior, pendingGmail: [...prior.pendingGmail] } : newState('gmail', account);
  const now = new Date().toISOString();
  state.lastAttemptAt = now;
  try {
    if (!state.initialized || !state.cursor) {
      const profile = await executeComposioTool({ toolSlug: 'GMAIL_GET_PROFILE', arguments: { user_id: 'me' }, profileId, connectedAccountId: account.id });
      const historyId = firstString(profile, ['historyId', 'history_id']);
      if (!historyId) throw new Error('Gmail did not return a history checkpoint.');
      state = { ...state, initialized: true, baselineComplete: true, cursor: historyId, pageToken: undefined, targetCursor: undefined, pendingGmail: [], lastSuccessAt: now, lastError: undefined };
      await persistState(profileId, state);
      return { state, result: { provider: 'gmail' as const, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, status: 'baseline' as const, newEvents: 0, processed: 0, note: 'Gmail history checkpoint initialized without replaying the existing mailbox.' } };
    }

    let historyResult: unknown = null;
    if (!state.pendingGmail.length) {
      historyResult = await executeComposioTool({ toolSlug: 'GMAIL_LIST_HISTORY', arguments: { user_id: 'me', start_history_id: state.cursor, max_results: 100, history_types: ['messageAdded'], ...(state.pageToken ? { page_token: state.pageToken } : {}) }, profileId, connectedAccountId: account.id });
      const history = findArray(historyResult, 'history');
      const additions = gmailAdded(history);
      const existing = new Set(state.pendingGmail.map((item) => item.id));
      for (const item of additions) if (!existing.has(item.id)) state.pendingGmail.push(item);
      const nextPageToken = firstString(historyResult, ['nextPageToken', 'next_page_token']);
      const latestHistoryId = firstString(historyResult, ['historyId', 'history_id']);
      state.pageToken = nextPageToken || undefined;
      if (latestHistoryId) state.targetCursor = latestHistoryId;
    }

    const batch = state.pendingGmail.slice(0, 20);
    let newEvents = 0;
    for (const pending of batch) {
      const message = await executeComposioTool({ toolSlug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', arguments: { user_id: 'me', message_id: pending.id, format: 'metadata' }, profileId, connectedAccountId: account.id });
      const meta = headerMetadata(message);
      const labels = meta.labels.length ? meta.labels : pending.labels;
      if (meta.id && recentEnough(meta.timestamp)) {
        await recordInboundEvent(profileId, { provider: 'gmail', type: 'message_received', sourceId: meta.id, summary: `${meta.subject || 'New Gmail message'}${meta.sender ? ` — ${meta.sender}` : ''}`, metadata: { subject: meta.subject, sender: meta.sender, receivedAt: meta.timestamp, important: labels.includes('IMPORTANT'), labels, url: meta.url, accountId: account.id || '' } });
        newEvents += 1;
      }
    }
    state.pendingGmail = state.pendingGmail.slice(batch.length);
    if (!state.pageToken && !state.pendingGmail.length && state.targetCursor) {
      state.cursor = state.targetCursor;
      state.targetCursor = undefined;
    }
    state.processedEvents += newEvents;
    state.lastSuccessAt = now;
    state.lastError = undefined;
    state.baselineComplete = true;
    await persistState(profileId, state);
    return { state, result: { provider: 'gmail' as const, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, status: 'synced' as const, newEvents, processed: batch.length, ...(state.pageToken || state.pendingGmail.length ? { note: 'Additional Gmail delta pages/messages remain queued for the next bounded sync run.' } : {}) } };
  } catch (error) {
    const message = error instanceof Error ? clip(error.message, 500) : 'Gmail sync failed.';
    const checkpointInvalid = /history.*(old|invalid)|404|invalidargument/i.test(message);
    if (checkpointInvalid) {
      try {
        const profile = await executeComposioTool({ toolSlug: 'GMAIL_GET_PROFILE', arguments: { user_id: 'me' }, profileId, connectedAccountId: account.id });
        const historyId = firstString(profile, ['historyId', 'history_id']);
        if (historyId) state = { ...state, initialized: true, baselineComplete: true, cursor: historyId, pageToken: undefined, targetCursor: undefined, pendingGmail: [], lastSuccessAt: now, lastError: undefined };
      } catch {}
    } else state.lastError = message;
    await persistState(profileId, state);
    return { state, result: { provider: 'gmail' as const, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, status: state.lastError ? 'degraded' as const : 'baseline' as const, newEvents: 0, processed: 0, note: state.lastError || 'Gmail checkpoint was reset safely after an invalid history cursor.' } };
  }
}

function outlookPage(value: unknown) {
  const containers = objects(value);
  const container = containers.find((record) => Array.isArray(record.value) && (typeof record['@odata.deltaLink'] === 'string' || typeof record['@odata.nextLink'] === 'string' || record.value.length >= 0));
  const items = Array.isArray(container?.value) ? container!.value as unknown[] : [];
  const nextLink = typeof container?.['@odata.nextLink'] === 'string' ? String(container['@odata.nextLink']) : '';
  const deltaLink = typeof container?.['@odata.deltaLink'] === 'string' ? String(container['@odata.deltaLink']) : '';
  return { items, nextLink, deltaLink };
}

function outlookMessage(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (item['@removed']) return null;
  const id = typeof item.id === 'string' ? item.id : '';
  if (!id) return null;
  const from = item.from && typeof item.from === 'object' ? item.from as Record<string, unknown> : null;
  const emailAddress = from?.emailAddress && typeof from.emailAddress === 'object' ? from.emailAddress as Record<string, unknown> : null;
  const senderName = typeof emailAddress?.name === 'string' ? emailAddress.name : '';
  const senderAddress = typeof emailAddress?.address === 'string' ? emailAddress.address : '';
  return {
    id,
    subject: typeof item.subject === 'string' ? clip(item.subject, 300) : '',
    sender: clip(senderName && senderAddress ? `${senderName} <${senderAddress}>` : senderAddress || senderName, 300),
    receivedAt: typeof item.receivedDateTime === 'string' ? item.receivedDateTime : '',
    importance: typeof item.importance === 'string' ? item.importance.toLowerCase() : 'normal',
    url: typeof item.webLink === 'string' ? item.webLink : '',
  };
}

async function syncOutlook(profileId: string, account: { id?: string; label: string }, prior?: CommunicationsSyncState) {
  let state = prior ? { ...prior, pendingGmail: [] } : newState('outlook', account);
  const now = new Date().toISOString();
  state.lastAttemptAt = now;
  try {
    if (!state.initialized || (!state.cursor && !state.pageToken)) {
      const baseline = await executeComposioTool({ toolSlug: 'OUTLOOK_GET_MAIL_DELTA', arguments: { user_id: 'me', folder_id: 'inbox', top: 1, select: ['id','subject','from','receivedDateTime','importance','webLink'] }, profileId, connectedAccountId: account.id });
      const page = outlookPage(baseline);
      const cursor = page.deltaLink || page.nextLink;
      if (!cursor) throw new Error('Outlook did not return a delta checkpoint.');
      state = { ...state, initialized: true, baselineComplete: Boolean(page.deltaLink), cursor: page.deltaLink || undefined, pageToken: page.deltaLink ? undefined : page.nextLink, lastSuccessAt: now, lastError: undefined };
      await persistState(profileId, state);
      return { state, result: { provider: 'outlook' as const, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, status: 'baseline' as const, newEvents: 0, processed: 0, note: page.deltaLink ? 'Outlook delta checkpoint initialized without replaying existing inbox mail.' : 'Outlook baseline pagination started; existing mail remains suppressed.' } };
    }

    const args: Record<string, unknown> = { user_id: 'me', folder_id: 'inbox', top: 100, select: ['id','subject','from','receivedDateTime','importance','webLink'] };
    if (state.pageToken) args.skip_token = state.pageToken;
    else args.delta_token = state.cursor;
    const suppressExisting = !state.baselineComplete;
    const response = await executeComposioTool({ toolSlug: 'OUTLOOK_GET_MAIL_DELTA', arguments: args, profileId, connectedAccountId: account.id });
    const page = outlookPage(response);
    let newEvents = 0;
    let processed = 0;
    for (const raw of page.items.slice(0, 100)) {
      const item = outlookMessage(raw); if (!item) continue; processed += 1;
      if (suppressExisting || !recentEnough(item.receivedAt)) continue;
      await recordInboundEvent(profileId, { provider: 'outlook', type: 'message_received', sourceId: item.id, summary: `${item.subject || 'New Outlook message'}${item.sender ? ` — ${item.sender}` : ''}`, metadata: { subject: item.subject, sender: item.sender, receivedAt: item.receivedAt, importance: item.importance, important: item.importance === 'high', url: item.url, accountId: account.id || '' } });
      newEvents += 1;
    }
    if (page.nextLink) state.pageToken = page.nextLink;
    else {
      state.pageToken = undefined;
      if (page.deltaLink) state.cursor = page.deltaLink;
      state.baselineComplete = true;
    }
    state.processedEvents += newEvents;
    state.lastSuccessAt = now;
    state.lastError = undefined;
    await persistState(profileId, state);
    return { state, result: { provider: 'outlook' as const, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, status: 'synced' as const, newEvents, processed, ...(page.nextLink ? { note: 'Additional Outlook delta pages remain queued for the next bounded sync run.' } : {}) } };
  } catch (error) {
    const message = error instanceof Error ? clip(error.message, 500) : 'Outlook sync failed.';
    if (/410|syncstate|delta.*invalid|resync/i.test(message)) state = { ...state, initialized: false, baselineComplete: false, cursor: undefined, pageToken: undefined, lastError: undefined };
    else state.lastError = message;
    await persistState(profileId, state);
    return { state, result: { provider: 'outlook' as const, ...(account.id ? { accountId: account.id } : {}), accountLabel: account.label, status: state.lastError ? 'degraded' as const : 'baseline' as const, newEvents: 0, processed: 0, note: state.lastError || 'Outlook delta checkpoint will be safely re-initialized on the next run.' } };
  }
}

export async function runCommunicationsSync(args: { profileId: string; persist?: boolean }) {
  const records = await loadRecords(args.profileId);
  const byKey = new Map(records.states.map((state) => [stateKey(state.provider, state.accountId), state]));
  const [gmailAccounts, outlookAccounts] = await Promise.all([providerAccounts(args.profileId, 'gmail'), providerAccounts(args.profileId, 'outlook')]);
  const jobs: Array<Promise<{ state: CommunicationsSyncState; result: CommunicationsProviderResult }>> = [];
  for (const account of gmailAccounts) jobs.push(syncGmail(args.profileId, account, byKey.get(stateKey('gmail', account.id))));
  for (const account of outlookAccounts) jobs.push(syncOutlook(args.profileId, account, byKey.get(stateKey('outlook', account.id))));
  const completed = await Promise.all(jobs);
  const results = completed.map((item) => item.result);
  if (!gmailAccounts.length) results.push({ provider: 'gmail', accountLabel: 'Gmail', status: 'unavailable', newEvents: 0, processed: 0, note: 'No active Gmail connection is available to the ELP profile.' });
  if (!outlookAccounts.length) results.push({ provider: 'outlook', accountLabel: 'Outlook', status: 'unavailable', newEvents: 0, processed: 0, note: 'No active Outlook connection is available to the ELP profile.' });
  const newEvents = results.reduce((sum, item) => sum + item.newEvents, 0);
  if (newEvents > 0) {
    await refreshNotifications(args.profileId).catch(() => undefined);
    await runInterruptManager({ profileId: args.profileId, persist: true }).catch(() => undefined);
  }
  const run: CommunicationsSyncRun = { id: randomUUID(), generatedAt: new Date().toISOString(), results, newEvents, degraded: results.filter((item) => item.status === 'degraded').length };
  return args.persist === false ? run : persistRun(args.profileId, run);
}

export async function getCommunicationsSyncSnapshot(profileId: string): Promise<CommunicationsSyncSnapshot> {
  const records = await loadRecords(profileId);
  return { configured: Boolean(records.handles), generatedAt: new Date().toISOString(), states: records.states.sort((a,b) => a.provider.localeCompare(b.provider) || a.accountLabel.localeCompare(b.accountLabel)), latestRun: records.latestRun };
}
