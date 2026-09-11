const DEFAULT_BASE_URL = 'https://backend.composio.dev/api/v3.1';

export type ComposioToolSummary = {
  slug: string;
  name: string;
  description: string;
  toolkit?: string;
  inputSchema?: Record<string, unknown>;
};

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

  const body: Record<string, unknown> = {
    arguments: args.arguments,
    user_id: args.profileId,
    version: 'latest',
  };
  if (args.connectedAccountId) body.connected_account_id = args.connectedAccountId;

  return request(`/tools/execute/${encodeURIComponent(args.toolSlug)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
