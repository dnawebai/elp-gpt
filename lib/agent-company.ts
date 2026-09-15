export type CompanyId = 'shared' | 'iquash' | 'mezcalsearch' | 'dnaweb' | 'elp_owner';

export type CompanyGoal = {
  company: CompanyId;
  objective: string;
  requested_position?: string;
  acceptance_criteria?: string[];
  context?: Record<string, unknown>;
  max_attempts?: number;
};

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

function baseUrl() {
  const value = process.env.ELP_AGENT_COMPANY_URL?.trim();
  if (!value) throw new Error('ELP_AGENT_COMPANY_URL is not configured.');
  return value.replace(/\/$/, '');
}

async function companyRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.ELP_AGENT_COMPANY_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `Agent Company request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export function createCompanyGoal(goal: CompanyGoal) {
  return companyRequest('/v1/goals', { method: 'POST', body: goal });
}

export function executeCompanyJob(jobId: string) {
  return companyRequest(`/v1/jobs/${encodeURIComponent(jobId)}/execute`, { method: 'POST' });
}

export function getCompanyJob(jobId: string) {
  return companyRequest(`/v1/jobs/${encodeURIComponent(jobId)}`);
}

export function listCompanyJobs() {
  return companyRequest('/v1/jobs');
}

export function listCompanyEvents() {
  return companyRequest('/v1/events');
}

export function listCompanyPositions() {
  return companyRequest('/companies');
}

export function listAgentPerformance() {
  return companyRequest('/v1/agents/performance');
}
