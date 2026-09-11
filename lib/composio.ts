const DEFAULT_BASE_URL = 'https://backend.composio.dev/api/v3.1';

export type ComposioToolSummary = {
  slug: string;
  name: string;
  description: string;
  toolkit?: string;
  inputSchema?: Record<string, unknown>;
};

type ComposioIdentityMode = 'profile' | 'owner-user' | 'owner-accounts';

function getConfig() {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  const baseUrl = (process.env.COMPOSIO_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  return { apiKey, baseUrl };
}

function configuredToolkitAllowlist() {
  const value = process.env.LUKE_ALLOWED_TOOLKITS?.trim();
  if (!value) return null;
  const items = value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return items.length ? new Set(items) : null;
}

function isOwnerModeEnabled() {
  return process.env.LUKE_SINGLE_USER_MODE?.trim().toLowerCase() === 'true';
}

function configuredOwnerUserId() {
  return process.env.LUKE_COMPOSIO_OWNER_USER_ID?.trim() || null;
}

function configuredOwnerAccountBindings() {
  const raw = process.env.LUKE_COMPOSIO_OWNER_ACCOUNT_BINDINGS?.trim();
  const bindings = new Map<string, string>();
  if (!raw) return bindings;

  for (const entry of raw.split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const toolkit = entry.slice(0, separator).trim().toUpperCase();
    const connectedAccountId = entry.slice(separator + 1).trim();
    if (toolkit && connectedAccountId) bindings.set(toolkit, connectedAccountId);
  }
  return bindings;
}

function resolveOwnerConnectedAccountId(toolSlug: string) {
  if (!isOwnerModeEnabled()) return null;
  const normalized = toolSlug.trim().toUpperCase();
  const bindings = configuredOwnerAccountBindings();
  const matchingToolkit = [...bindings.keys()]
    .filter((toolkit) => normalized === toolkit || normalized.startsWith(`${toolkit}_`))
    .sort((a, b) => b.length - a.length)[0];
  return matchingToolkit ? bindings.get(matchingToolkit) || null : null;
}

export function getComposioIdentityMode(): ComposioIdentityMode {
  if (!isOwnerModeEnabled()) return 'profile';
  if (configuredOwnerAccountBindings().size > 0) return 'owner-accounts';
  if (configuredOwnerUserId()) return 'owner-user';
  return 'profile';
}

export function getComposioExecutionUserId(profileId: string) {
  if (getComposioIdentityMode() === 'owner-user') return configuredOwnerUserId() as string;
  return profileId;
}

export function getComposioIdentityHealth() {
  const singleUserMode = isOwnerModeEnabled();
  const ownerUserConfigured = Boolean(configuredOwnerUserId());
  const bindings = configuredOwnerAccountBindings();
  return {
    mode: getComposioIdentityMode(),
    singleUserMode,
    ownerUserConfigured,
    boundToolkits: [...bindings.keys()].sort(),
    bindingCount: bindings.size,
    ready: !singleUserMode || ownerUserConfigured || bindings.size > 0,
  };
}

export function isComposioConfigured() {
  return Boolean(getConfig().apiKey);
}

export function isToolkitAllowed(toolSlug: string) {
  const allowlist = configuredToolkitAllowlist();
  if (!allowlist) return true;
  const normalized = toolSlug.trim().toUpperCase();
  for (const toolkit of allowlist) {
    if (normalized === toolkit || normalized.startsWith(`${toolkit}_`)) return true;
  }
  return false;
}

async function request(path: string, init?: RequestInit) {
  const { apiKey, baseUrl } = getConfig();
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
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Composio request failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return data;
}

export async function searchComposioTools(query: string, toolkit?: string) {
  const normalizedToolkit = toolkit?.trim().toUpperCase();
  if (normalizedToolkit && !isToolkitAllowed(`${normalizedToolkit}_TOOL`)) return [];

  const params = new URLSearchParams({
    search: query.slice(0, 300),
    limit: '6',
    toolkit_versions: 'latest',
  });
  if (normalizedToolkit) params.set('toolkits', normalizedToolkit);

  const data = (await request(`/tools?${params.toString()}`)) as {
    items?: Array<Record<string, unknown>>;
    tools?: Array<Record<string, unknown>>;
  };
  const items = data.items || data.tools || [];

  return items.slice(0, 12).map((item): ComposioToolSummary => ({
    slug: String(item.slug || item.name || ''),
    name: String(item.name || item.slug || ''),
    description: String(item.description || ''),
    toolkit: typeof item.toolkit === 'string' ? item.toolkit : undefined,
    inputSchema:
      item.input_parameters && typeof item.input_parameters === 'object'
        ? (item.input_parameters as Record<string, unknown>)
        : item.input_schema && typeof item.input_schema === 'object'
          ? (item.input_schema as Record<string, unknown>)
          : undefined,
  })).filter((tool) => tool.slug && isToolkitAllowed(tool.slug)).slice(0, 6);
}

export async function executeComposioTool(args: {
  toolSlug: string;
  arguments: Record<string, unknown>;
  profileId: string;
  connectedAccountId?: string;
}) {
  if (!isToolkitAllowed(args.toolSlug)) {
    throw new Error('This toolkit is not allowed by the current LUKE deployment policy.');
  }

  const identityHealth = getComposioIdentityHealth();
  if (!identityHealth.ready) {
    throw new Error(
      'LUKE_SINGLE_USER_MODE is enabled but no Composio owner user or connected-account bindings are configured. Refusing ambiguous execution.',
    );
  }

  const connectedAccountId = args.connectedAccountId || resolveOwnerConnectedAccountId(args.toolSlug);
  const ownerUserId = configuredOwnerUserId();
  const body: Record<string, unknown> = {
    arguments: args.arguments,
    version: 'latest',
  };

  if (connectedAccountId) {
    body.connected_account_id = connectedAccountId;
  }

  // For an explicitly bound authenticated account, Composio can resolve auth by
  // connected_account_id alone. Omitting a mismatched user_id prevents private
  // account scoping failures. No-auth tools still receive a profile/user ID.
  if (!connectedAccountId || ownerUserId) {
    body.user_id = ownerUserId || args.profileId;
  }

  return request(`/tools/execute/${encodeURIComponent(args.toolSlug)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
