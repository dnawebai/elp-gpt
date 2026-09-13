import { getElpOwnerAccountBindings } from '@/lib/elp-config';

const DEFAULT_BASE_URL = 'https://backend.composio.dev/api/v3.1';

export type ConnectionStatus = 'ACTIVE' | 'INITIALIZING' | 'INITIATED' | 'FAILED' | 'EXPIRED' | 'INACTIVE' | string;
export type ConnectionRisk = 'read' | 'write' | 'high';

export type ConnectionPolicy = {
  slug: string;
  label: string;
  description: string;
  risk: ConnectionRisk;
  read: boolean;
  write: boolean;
  approval: 'none' | 'required';
};

export type ConnectedAccountSummary = {
  id: string;
  toolkit: string;
  label: string;
  alias: string | null;
  userId: string | null;
  status: ConnectionStatus;
  disabled: boolean;
  authScheme: string | null;
  accountType: 'PRIVATE' | 'SHARED' | string;
  createdAt: string | null;
  updatedAt: string | null;
  source: 'profile' | 'owner-binding';
  risk: ConnectionRisk;
  read: boolean;
  write: boolean;
  approval: 'none' | 'required';
};

export const CONNECTION_POLICIES: readonly ConnectionPolicy[] = [
  { slug: 'gmail', label: 'Gmail', description: 'Email search, reading, drafts and approved sends.', risk: 'write', read: true, write: true, approval: 'required' },
  { slug: 'googlecalendar', label: 'Google Calendar', description: 'Schedule intelligence plus approved event changes.', risk: 'write', read: true, write: true, approval: 'required' },
  { slug: 'googledrive', label: 'Google Drive', description: 'Find and read files; approved file changes remain gated.', risk: 'write', read: true, write: true, approval: 'required' },
  { slug: 'github', label: 'GitHub', description: 'Repository intelligence plus approved code and workflow changes.', risk: 'high', read: true, write: true, approval: 'required' },
  { slug: 'slack', label: 'Slack', description: 'Workspace search and approved outbound messages.', risk: 'write', read: true, write: true, approval: 'required' },
  { slug: 'microsoftoutlook', label: 'Microsoft Outlook', description: 'Mail and calendar access for Microsoft accounts.', risk: 'write', read: true, write: true, approval: 'required' },
  { slug: 'linkedin', label: 'LinkedIn', description: 'Professional-network context and approved actions when supported.', risk: 'high', read: true, write: true, approval: 'required' },
] as const;

function config() {
  return {
    apiKey: process.env.COMPOSIO_API_KEY?.trim(),
    baseUrl: (process.env.COMPOSIO_API_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
  };
}

export function isConnectionsConfigured() {
  return Boolean(config().apiKey);
}

async function request(path: string, init?: RequestInit) {
  const { apiKey, baseUrl } = config();
  if (!apiKey) throw new Error('Composio is not configured.');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: unknown = text;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Composio connection request failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return data;
}

function ownerBindings() {
  const map = new Map<string, string>();
  const raw = getElpOwnerAccountBindings();
  if (!raw) return map;
  for (const part of raw.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const toolkit = part.slice(0, separator).trim().toLowerCase();
    const accountId = part.slice(separator + 1).trim();
    if (toolkit && accountId) map.set(toolkit, accountId);
  }
  return map;
}

function policyFor(toolkit: string): ConnectionPolicy {
  const normalized = toolkit.toLowerCase();
  return CONNECTION_POLICIES.find((item) => item.slug === normalized) || {
    slug: normalized,
    label: toolkit,
    description: 'Connected external service.',
    risk: 'write',
    read: true,
    write: true,
    approval: 'required',
  };
}

function normalizeAccount(item: Record<string, unknown>, source: ConnectedAccountSummary['source']): ConnectedAccountSummary | null {
  const id = typeof item.id === 'string' ? item.id : '';
  const toolkitObject = item.toolkit && typeof item.toolkit === 'object' ? item.toolkit as Record<string, unknown> : null;
  const toolkit = typeof toolkitObject?.slug === 'string' ? toolkitObject.slug.toLowerCase() : '';
  if (!id || !toolkit) return null;
  const policy = policyFor(toolkit);
  const experimental = item.experimental && typeof item.experimental === 'object' ? item.experimental as Record<string, unknown> : null;
  const authConfig = item.auth_config && typeof item.auth_config === 'object' ? item.auth_config as Record<string, unknown> : null;
  return {
    id,
    toolkit,
    label: policy.label,
    alias: typeof item.alias === 'string' && item.alias ? item.alias : null,
    userId: typeof item.user_id === 'string' ? item.user_id : null,
    status: typeof item.status === 'string' ? item.status : 'UNKNOWN',
    disabled: item.is_disabled === true,
    authScheme: typeof item.authScheme === 'string' ? item.authScheme : typeof authConfig?.auth_scheme === 'string' ? authConfig.auth_scheme : null,
    accountType: typeof experimental?.account_type === 'string' ? experimental.account_type : 'PRIVATE',
    createdAt: typeof item.created_at === 'string' ? item.created_at : null,
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : null,
    source,
    risk: policy.risk,
    read: policy.read,
    write: policy.write,
    approval: policy.approval,
  };
}

async function listByQuery(params: URLSearchParams, source: ConnectedAccountSummary['source']) {
  params.set('limit', '50');
  params.set('account_type', 'ALL');
  params.set('order_by', 'updated_at');
  params.set('order_direction', 'desc');
  const accounts: ConnectedAccountSummary[] = [];
  let cursor = '';
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams(params);
    if (cursor) query.set('cursor', cursor);
    const data = await request(`/connected_accounts?${query.toString()}`) as { items?: Array<Record<string, unknown>>; next_cursor?: string | null };
    for (const item of data.items || []) {
      const normalized = normalizeAccount(item, source);
      if (normalized) accounts.push(normalized);
    }
    cursor = typeof data.next_cursor === 'string' ? data.next_cursor : '';
    if (!cursor) break;
  }
  return accounts;
}

export async function listConnectedAccounts(profileId: string) {
  if (!isConnectionsConfigured()) return [] as ConnectedAccountSummary[];
  const profileQuery = new URLSearchParams();
  profileQuery.append('user_ids', profileId);
  const profileAccounts = await listByQuery(profileQuery, 'profile');

  const bindings = ownerBindings();
  const boundIds = [...new Set(bindings.values())];
  let ownerAccounts: ConnectedAccountSummary[] = [];
  if (boundIds.length) {
    const ownerQuery = new URLSearchParams();
    for (const id of boundIds) ownerQuery.append('connected_account_ids', id);
    ownerAccounts = await listByQuery(ownerQuery, 'owner-binding');
  }

  const byId = new Map<string, ConnectedAccountSummary>();
  for (const account of ownerAccounts) byId.set(account.id, account);
  for (const account of profileAccounts) byId.set(account.id, account);
  return [...byId.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function findActiveProfileConnection(profileId: string, toolkit: string) {
  if (!isConnectionsConfigured()) return null;
  const query = new URLSearchParams();
  query.append('user_ids', profileId);
  query.append('toolkit_slugs', toolkit.toLowerCase());
  query.append('statuses', 'ACTIVE');
  query.set('limit', '10');
  query.set('order_by', 'updated_at');
  query.set('order_direction', 'desc');
  const data = await request(`/connected_accounts?${query.toString()}`) as { items?: Array<Record<string, unknown>> };
  for (const item of data.items || []) {
    const account = normalizeAccount(item, 'profile');
    if (account && !account.disabled) return account;
  }
  return null;
}

async function findOrCreateManagedAuthConfig(toolkit: string) {
  const normalized = toolkit.toLowerCase();
  const query = new URLSearchParams({ toolkit_slug: normalized, is_composio_managed: 'true', show_disabled: 'false', limit: '50' });
  const listed = await request(`/auth_configs?${query.toString()}`) as { items?: Array<Record<string, unknown>> };
  const existing = (listed.items || []).find((item) => item.status === 'ENABLED' && item.is_composio_managed !== false);
  if (existing && typeof existing.id === 'string') return existing.id;

  const created = await request('/auth_configs', {
    method: 'POST',
    body: JSON.stringify({ toolkit: { slug: normalized }, auth_config: { type: 'use_composio_managed_auth', credentials: {}, restrict_to_following_tools: [] } }),
  }) as { auth_config?: { id?: string } };
  const id = created.auth_config?.id;
  if (!id) throw new Error(`No managed authentication configuration is available for ${normalized}.`);
  return id;
}

export async function createConnectionLink(args: { profileId: string; toolkit: string; callbackUrl: string }) {
  const normalized = args.toolkit.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,80}$/.test(normalized)) throw new Error('Invalid toolkit.');
  const authConfigId = await findOrCreateManagedAuthConfig(normalized);
  const result = await request('/connected_accounts/link', {
    method: 'POST',
    body: JSON.stringify({
      auth_config_id: authConfigId,
      user_id: args.profileId,
      alias: `ELP ${policyFor(normalized).label}`.slice(0, 80),
      callback_url: args.callbackUrl,
    }),
  }) as { redirect_url?: string; link_token?: string; expires_at?: string; connected_account_id?: string };
  if (!result.redirect_url) throw new Error('Composio did not return an authentication URL.');
  return {
    toolkit: normalized,
    redirectUrl: result.redirect_url,
    expiresAt: result.expires_at || null,
    connectedAccountId: result.connected_account_id || null,
  };
}

export async function setConnectedAccountEnabled(profileId: string, accountId: string, enabled: boolean) {
  const accounts = await listConnectedAccounts(profileId);
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new Error('Connected account not found for this ELP profile.');
  await request(`/connected_accounts/${encodeURIComponent(accountId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
  return { ok: true, enabled };
}

export async function completeConnectionAuth(profileId: string, sessionUri: string) {
  if (!sessionUri || sessionUri.length > 2000) throw new Error('Invalid authentication session.');
  return request('/connected_accounts/complete_auth', {
    method: 'POST',
    body: JSON.stringify({ session_uri: sessionUri, user_id: profileId }),
  }) as Promise<{ connected_account_id?: string; toolkit_slug?: string; status?: string }>;
}

export function connectionPolicyFor(toolkit: string) {
  return policyFor(toolkit);
}
