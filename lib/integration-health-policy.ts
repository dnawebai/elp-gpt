import type { ConnectedAccountSummary } from '@/lib/connections';

export type IntegrationHealthStatus = 'healthy' | 'watch' | 'degraded' | 'broken' | 'disconnected' | 'disabled' | 'provider_limited';
export type IntegrationSeverity = 'info' | 'warning' | 'high' | 'critical';
export type IntegrationRepairKind = 'none' | 'enable' | 'resync' | 'renew' | 'reconnect' | 'connect' | 'configure' | 'provider_boundary';

export type IntegrationHealthIssue = {
  id: string;
  toolkit: string;
  provider?: string;
  accountId?: string;
  accountLabel: string;
  status: IntegrationHealthStatus;
  severity: IntegrationSeverity;
  issue: string;
  detail: string;
  repairKind: IntegrationRepairKind;
  repairLabel?: string;
  lastSuccessAt?: string;
  source: 'connection' | 'subscription' | 'communications' | 'coverage';
};

export function normalizeToolkit(value: string) {
  const toolkit = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (toolkit === 'microsoftoutlook' || toolkit === 'outlook') return 'outlook';
  if (toolkit === 'googlecalendar') return 'google_calendar';
  if (toolkit === 'googledrive') return 'google_drive';
  return toolkit;
}

export function likelyAuthFailure(value: string | undefined) {
  if (!value) return false;
  return /(401|403|invalid[_ -]?grant|unauthori[sz]ed|expired.*token|token.*expired|authentication failed|auth.*failed|credential.*invalid)/i.test(value);
}

export function likelyMisboundAccount(value: string | undefined) {
  if (!value) return false;
  return /(wrong.*account|misbound|business account.*id|waba.*id|invalid.*waba|object.*does not exist|unsupported get request|account identifier)/i.test(value);
}

export function sanitizeDiagnostic(value: string | undefined, max = 500) {
  if (!value) return '';
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|access_token|api_key|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(?:sk|pk|key|token|secret)_[A-Za-z0-9_-]{16,}\b/gi, '[redacted]')
    .slice(0, Math.max(40, max));
}

export function classifyConnection(account: ConnectedAccountSummary): Omit<IntegrationHealthIssue, 'id'> {
  const toolkit = normalizeToolkit(account.toolkit);
  const accountLabel = account.alias || account.label || account.toolkit;
  if (account.disabled) {
    return {
      toolkit,
      accountId: account.id,
      accountLabel,
      status: 'disabled',
      severity: 'warning',
      issue: 'Connection disabled',
      detail: 'This account is intentionally disabled. ELP will not re-enable it automatically.',
      repairKind: 'enable',
      repairLabel: 'Enable account',
      source: 'connection',
    };
  }
  const status = account.status.toUpperCase();
  if (status === 'ACTIVE') {
    return {
      toolkit,
      accountId: account.id,
      accountLabel,
      status: 'healthy',
      severity: 'info',
      issue: 'Connection active',
      detail: `Connected account is active (${account.source === 'profile' ? 'profile-owned' : 'owner binding'}).`,
      repairKind: 'none',
      source: 'connection',
    };
  }
  if (status === 'FAILED' || status === 'EXPIRED') {
    return {
      toolkit,
      accountId: account.id,
      accountLabel,
      status: 'broken',
      severity: 'critical',
      issue: `${status === 'EXPIRED' ? 'Connection expired' : 'Connection failed'}`,
      detail: 'Provider authorization must be renewed before ELP can use this account.',
      repairKind: 'reconnect',
      repairLabel: 'Reconnect',
      source: 'connection',
    };
  }
  if (status === 'INACTIVE') {
    return {
      toolkit,
      accountId: account.id,
      accountLabel,
      status: 'degraded',
      severity: 'high',
      issue: 'Connection inactive',
      detail: 'The account is present but not active. Reauthorization is recommended.',
      repairKind: 'reconnect',
      repairLabel: 'Reconnect',
      source: 'connection',
    };
  }
  if (status === 'INITIALIZING' || status === 'INITIATED') {
    return {
      toolkit,
      accountId: account.id,
      accountLabel,
      status: 'watch',
      severity: 'warning',
      issue: 'Authentication incomplete',
      detail: 'The provider authorization flow has started but is not yet active.',
      repairKind: 'reconnect',
      repairLabel: 'Resume connection',
      source: 'connection',
    };
  }
  return {
    toolkit,
    accountId: account.id,
    accountLabel,
    status: 'degraded',
    severity: 'warning',
    issue: `Unexpected connection state: ${status || 'UNKNOWN'}`,
    detail: 'ELP cannot confirm this connection is usable.',
    repairKind: 'reconnect',
    repairLabel: 'Reconnect',
    source: 'connection',
  };
}

export function classifyProviderHealth(input: {
  provider: string;
  accountId?: string;
  accountLabel: string;
  status: string;
  mode?: string;
  note?: string;
  lastSuccessAt?: string;
}): Omit<IntegrationHealthIssue, 'id'> {
  const toolkit = normalizeToolkit(input.provider);
  const note = sanitizeDiagnostic(input.note);
  if (input.status === 'active' || input.status === 'renewed' || input.status === 'healthy_fallback') {
    return {
      toolkit,
      provider: input.provider,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      accountLabel: input.accountLabel,
      status: 'healthy',
      severity: 'info',
      issue: input.status === 'healthy_fallback' ? 'Healthy incremental fallback' : 'Native subscription healthy',
      detail: note || 'Provider monitoring is healthy.',
      repairKind: 'none',
      ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
      source: 'subscription',
    };
  }
  if (input.status === 'blocked') {
    return {
      toolkit,
      provider: input.provider,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      accountLabel: input.accountLabel,
      status: 'provider_limited',
      severity: 'info',
      issue: 'Provider capability unavailable',
      detail: note || 'The connected provider surface does not expose the required subscription operation.',
      repairKind: 'provider_boundary',
      source: 'subscription',
    };
  }
  if (input.status === 'unavailable') {
    return {
      toolkit,
      provider: input.provider,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      accountLabel: input.accountLabel,
      status: 'disconnected',
      severity: 'warning',
      issue: 'Provider unavailable',
      detail: note || 'No active provider connection is available.',
      repairKind: 'connect',
      repairLabel: 'Connect',
      source: 'subscription',
    };
  }
  if (input.status === 'pending_configuration') {
    return {
      toolkit,
      provider: input.provider,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      accountLabel: input.accountLabel,
      status: 'degraded',
      severity: 'high',
      issue: 'Provider configuration incomplete',
      detail: note || 'Additional provider configuration is required.',
      repairKind: likelyMisboundAccount(note) ? 'reconnect' : 'configure',
      repairLabel: likelyMisboundAccount(note) ? 'Reconnect correct account' : 'Review configuration',
      source: 'subscription',
    };
  }
  const authFailure = likelyAuthFailure(note);
  const misbound = likelyMisboundAccount(note);
  return {
    toolkit,
    provider: input.provider,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    accountLabel: input.accountLabel,
    status: input.status === 'degraded' ? 'broken' : 'degraded',
    severity: input.status === 'degraded' ? 'high' : 'warning',
    issue: misbound ? 'Account binding appears incorrect' : authFailure ? 'Provider authorization appears invalid' : 'Provider health degraded',
    detail: note || 'Provider health check did not succeed.',
    repairKind: misbound || authFailure ? 'reconnect' : toolkit === 'google_calendar' ? 'renew' : toolkit === 'gmail' || toolkit === 'outlook' ? 'resync' : 'configure',
    repairLabel: misbound || authFailure ? 'Reconnect' : toolkit === 'google_calendar' ? 'Renew subscription' : toolkit === 'gmail' || toolkit === 'outlook' ? 'Retry sync' : 'Review configuration',
    ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
    source: 'subscription',
  };
}

export function classifyCommunicationsState(input: {
  provider: 'gmail' | 'outlook';
  accountId?: string;
  accountLabel: string;
  baselineComplete: boolean;
  lastSuccessAt?: string;
  lastError?: string;
  now?: Date;
}): Omit<IntegrationHealthIssue, 'id'> {
  const now = input.now || new Date();
  const lastSuccess = input.lastSuccessAt ? Date.parse(input.lastSuccessAt) : Number.NaN;
  const stale = !Number.isFinite(lastSuccess) || now.getTime() - lastSuccess > 10 * 60_000;
  const error = sanitizeDiagnostic(input.lastError);
  if (!error && input.baselineComplete && !stale) {
    return {
      toolkit: input.provider,
      provider: input.provider,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      accountLabel: input.accountLabel,
      status: 'healthy',
      severity: 'info',
      issue: 'Incremental sync healthy',
      detail: 'Mailbox delta checkpoint is current.',
      repairKind: 'none',
      ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
      source: 'communications',
    };
  }
  const authFailure = likelyAuthFailure(error);
  return {
    toolkit: input.provider,
    provider: input.provider,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    accountLabel: input.accountLabel,
    status: authFailure ? 'broken' : 'degraded',
    severity: authFailure ? 'critical' : 'high',
    issue: authFailure ? 'Mailbox authorization failed' : !input.baselineComplete ? 'Mailbox baseline incomplete' : 'Mailbox sync stale',
    detail: error || (!input.baselineComplete ? 'Incremental baseline has not completed.' : 'No successful incremental synchronization was recorded in the last ten minutes.'),
    repairKind: authFailure ? 'reconnect' : 'resync',
    repairLabel: authFailure ? 'Reconnect' : 'Retry sync',
    ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
    source: 'communications',
  };
}

export function healthScore(issues: IntegrationHealthIssue[]) {
  const material = issues.filter((item) => item.status !== 'disconnected' && item.status !== 'provider_limited');
  if (!material.length) return 100;
  const penalty = material.reduce((sum, item) => sum + (
    item.status === 'broken' ? 28 :
    item.status === 'degraded' ? 16 :
    item.status === 'disabled' ? 8 :
    item.status === 'watch' ? 5 : 0
  ), 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty / Math.max(1, material.length / 4))));
}
