import { createHash } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { createTask, getTaskBoard } from '@/lib/task-router';

export type RepositoryRecommendation = 'priority' | 'investigate' | 'watch' | 'ignore';

export type RepositoryCandidate = {
  fullName: string;
  url: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  openIssues: number;
  pushedAt: string;
  updatedAt: string;
  license: string;
  ownerType: string;
  topics: string[];
  categories: string[];
  score: number;
  recommendation: RepositoryRecommendation;
  reasons: string[];
  adoptionBlocked: true;
};

export type RepositoryRadarSnapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  queryCount: number;
  candidates: RepositoryCandidate[];
  tasksCreated: number;
  errors: string[];
};

type SearchTrack = { category: string; query: string };
type GitHubRepository = {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  pushed_at?: string;
  updated_at?: string;
  archived?: boolean;
  fork?: boolean;
  topics?: string[];
  license?: { spdx_id?: string | null; name?: string | null } | null;
  owner?: { type?: string; login?: string } | null;
};

type SearchResult = { items?: GitHubRepository[]; message?: string };

const SEARCH_TRACKS: SearchTrack[] = [
  { category: 'orchestration', query: '"multi agent" orchestration AI archived:false fork:false stars:>25' },
  { category: 'memory', query: '"agent memory" LLM archived:false fork:false stars:>25' },
  { category: 'computer-use', query: '"computer use" agent browser archived:false fork:false stars:>25' },
  { category: 'mcp-a2a', query: 'MCP "model context protocol" agent archived:false fork:false stars:>25' },
  { category: 'mcp-a2a', query: 'A2A agent protocol archived:false fork:false stars:>25' },
  { category: 'evaluation', query: 'LLM eval observability agent archived:false fork:false stars:>25' },
  { category: 'coding', query: '"coding agent" autonomous archived:false fork:false stars:>25' },
  { category: 'research', query: '"deep research" RAG agent archived:false fork:false stars:>25' },
];

const RELEVANCE_TERMS = [
  'agent', 'agentic', 'orchestration', 'memory', 'browser', 'computer use', 'mcp', 'model context protocol',
  'a2a', 'evaluation', 'observability', 'coding', 'research', 'rag', 'workflow', 'multi-agent', 'tool use',
];

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function bounded(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function daysSince(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return 10_000;
  return Math.max(0, (Date.now() - time) / 86_400_000);
}
function recommendation(score: number): RepositoryRecommendation {
  if (score >= 78) return 'priority';
  if (score >= 65) return 'investigate';
  if (score >= 52) return 'watch';
  return 'ignore';
}
function candidateKey(fullName: string) {
  return createHash('sha256').update(fullName.toLowerCase()).digest('hex').slice(0, 18);
}

function tractionScore(stars: number) {
  if (stars >= 50_000) return 25;
  if (stars >= 10_000) return 23;
  if (stars >= 2_000) return 20;
  if (stars >= 500) return 16;
  if (stars >= 100) return 10;
  if (stars >= 25) return 5;
  return 0;
}
function freshnessScore(pushedAt: string) {
  const days = daysSince(pushedAt);
  if (days <= 14) return 20;
  if (days <= 45) return 17;
  if (days <= 120) return 13;
  if (days <= 365) return 7;
  return 1;
}

function scoreRepository(repo: GitHubRepository, categories: string[]): RepositoryCandidate | null {
  const fullName = repo.full_name?.trim();
  const url = repo.html_url?.trim();
  if (!fullName || !url || repo.archived || repo.fork) return null;
  const description = repo.description?.trim() || '';
  const topics = Array.isArray(repo.topics) ? repo.topics.filter((topic): topic is string => typeof topic === 'string').slice(0, 20) : [];
  const text = `${fullName} ${description} ${topics.join(' ')}`.toLowerCase();
  const matchedTerms = RELEVANCE_TERMS.filter((term) => text.includes(term));
  const stars = Math.max(0, Number(repo.stargazers_count) || 0);
  const forks = Math.max(0, Number(repo.forks_count) || 0);
  const pushedAt = repo.pushed_at || repo.updated_at || '';
  const license = repo.license?.spdx_id || repo.license?.name || 'UNKNOWN';
  const reasons: string[] = [];

  let score = 18;
  const relevance = Math.min(22, matchedTerms.length * 3 + Math.min(10, categories.length * 4));
  score += relevance;
  score += tractionScore(stars);
  score += freshnessScore(pushedAt);
  if (license !== 'UNKNOWN' && license !== 'NOASSERTION') score += 5;
  if (topics.length >= 3) score += 3;
  if (forks >= 1_000) score += 5;
  else if (forks >= 100) score += 3;
  if (repo.owner?.type === 'Organization') score += 2;
  if (!description) score -= 8;
  if (license === 'UNKNOWN' || license === 'NOASSERTION') score -= 5;
  if (daysSince(pushedAt) > 730) score -= 12;
  score = bounded(score);

  reasons.push(`${categories.length} ELP capability track${categories.length === 1 ? '' : 's'} matched`);
  reasons.push(`${stars.toLocaleString('en-US')} stars; last push ${Math.round(daysSince(pushedAt))} days ago`);
  if (matchedTerms.length) reasons.push(`Relevant signals: ${matchedTerms.slice(0, 6).join(', ')}`);
  reasons.push(license === 'UNKNOWN' || license === 'NOASSERTION' ? 'License requires review before adoption' : `License: ${license}`);

  return {
    fullName,
    url,
    description: clip(description || 'No repository description.', 500),
    language: repo.language || 'Unknown',
    stars,
    forks,
    openIssues: Math.max(0, Number(repo.open_issues_count) || 0),
    pushedAt,
    updatedAt: repo.updated_at || pushedAt,
    license,
    ownerType: repo.owner?.type || 'Unknown',
    topics,
    categories: [...new Set(categories)].sort(),
    score,
    recommendation: recommendation(score),
    reasons,
    adoptionBlocked: true,
  };
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_REPOSITORY_RADAR_TOKEN?.trim();
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ELP-GPT-Repository-Radar',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function searchGitHub(track: SearchTrack) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(track.query)}&sort=updated&order=desc&per_page=10`;
  const response = await fetch(url, { headers: githubHeaders(), cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({})) as SearchResult;
  if (!response.ok) throw new Error(`${track.category}: GitHub search failed (${response.status})${data.message ? ` ${data.message}` : ''}`);
  return Array.isArray(data.items) ? data.items : [];
}

async function getRadarSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`repository-radar-${profileId}`);
  await session.addPeers([elp]);
  return { elp, session };
}

function emptySnapshot(configured = false): RepositoryRadarSnapshot {
  return { configured, available: false, generatedAt: new Date().toISOString(), queryCount: 0, candidates: [], tasksCreated: 0, errors: [] };
}

export async function getRepositoryRadarSnapshot(profileId: string): Promise<RepositoryRadarSnapshot> {
  if (!process.env.HONCHO_API_KEY) return emptySnapshot(false);
  try {
    const handles = await getRadarSession(profileId);
    if (!handles) return emptySnapshot(false);
    const page = await handles.session.messages({ size: 30, reverse: true });
    const message = page.items.find((item) => item.metadata?.elpRepositoryRadar === true);
    if (!message) return emptySnapshot(true);
    const raw = typeof message.metadata?.candidatesJson === 'string' ? message.metadata.candidatesJson : '[]';
    const candidates = JSON.parse(raw) as RepositoryCandidate[];
    const rawErrors = typeof message.metadata?.errorsJson === 'string' ? message.metadata.errorsJson : '[]';
    const errors = JSON.parse(rawErrors) as string[];
    return {
      configured: true,
      available: Array.isArray(candidates) && candidates.length > 0,
      generatedAt: typeof message.metadata?.generatedAt === 'string' ? message.metadata.generatedAt : message.createdAt,
      queryCount: Number(message.metadata?.queryCount) || 0,
      candidates: Array.isArray(candidates) ? candidates.slice(0, 24) : [],
      tasksCreated: Number(message.metadata?.tasksCreated) || 0,
      errors: Array.isArray(errors) ? errors.slice(0, 12) : [],
    };
  } catch (error) {
    console.error('ELP repository radar read failed', error);
    return emptySnapshot(true);
  }
}

async function createResearchTasks(profileId: string, candidates: RepositoryCandidate[]) {
  if (!process.env.HONCHO_API_KEY) return 0;
  const board = await getTaskBoard(profileId);
  const open = [...board.queues.now, ...board.queues.working, ...board.queues.delegated, ...board.queues.decisions];
  let created = 0;
  for (const candidate of candidates.filter((item) => item.recommendation === 'priority').slice(0, 3)) {
    const sessionId = `repository-radar-${candidateKey(candidate.fullName)}`;
    if (open.some((task) => task.sessionId === sessionId && task.status !== 'completed' && task.status !== 'cancelled')) continue;
    await createTask(profileId, {
      objective: `Research only — do not install, execute, fork, deploy, or grant permissions. Evaluate ${candidate.fullName} for ELP GPT. Repository: ${candidate.url}. Score: ${candidate.score}/100. Categories: ${candidate.categories.join(', ')}. Determine architecture fit, maintenance quality, security implications, license compatibility, integration cost, overlap with current ELP components, measurable benefit, and a clear adopt / wrap / learn-from / reject recommendation.`,
      queue: 'working',
      owner: 'ai',
      priority: candidate.score >= 88 ? 'high' : 'normal',
      approval: 'none',
      source: 'repository-radar',
      sessionId,
      summary: `${candidate.fullName} scored ${candidate.score}/100. Third-party code adoption remains blocked pending explicit reviewed implementation.`,
    });
    created += 1;
  }
  return created;
}

export async function runRepositoryRadar(profileId: string): Promise<RepositoryRadarSnapshot> {
  const grouped = new Map<string, { repo: GitHubRepository; categories: Set<string> }>();
  const errors: string[] = [];

  for (const track of SEARCH_TRACKS) {
    try {
      const repos = await searchGitHub(track);
      for (const repo of repos) {
        const fullName = repo.full_name?.toLowerCase();
        if (!fullName) continue;
        const existing = grouped.get(fullName);
        if (existing) existing.categories.add(track.category);
        else grouped.set(fullName, { repo, categories: new Set([track.category]) });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${track.category}: search failed`);
    }
  }

  const candidates = [...grouped.values()]
    .map(({ repo, categories }) => scoreRepository(repo, [...categories]))
    .filter((item): item is RepositoryCandidate => Boolean(item))
    .sort((a, b) => b.score - a.score || b.stars - a.stars)
    .slice(0, 24);

  const tasksCreated = await createResearchTasks(profileId, candidates);
  const generatedAt = new Date().toISOString();
  const snapshot: RepositoryRadarSnapshot = {
    configured: true,
    available: candidates.length > 0,
    generatedAt,
    queryCount: SEARCH_TRACKS.length,
    candidates,
    tasksCreated,
    errors: errors.slice(0, 12),
  };

  const handles = await getRadarSession(profileId);
  if (handles) {
    const priority = candidates.filter((item) => item.recommendation === 'priority').length;
    const investigate = candidates.filter((item) => item.recommendation === 'investigate').length;
    await handles.session.addMessages([{
      peerId: handles.elp.id,
      content: `[REPOSITORY_RADAR] ${generatedAt}\n${candidates.length} candidates ranked; ${priority} priority; ${investigate} investigate; ${tasksCreated} research tasks created. No third-party code was installed or executed.`,
      metadata: {
        elpRepositoryRadar: true,
        recordVersion: 1,
        generatedAt,
        queryCount: SEARCH_TRACKS.length,
        tasksCreated,
        candidatesJson: JSON.stringify(candidates),
        errorsJson: JSON.stringify(errors.slice(0, 12)),
      },
    }]);
  }
  return snapshot;
}

export function repositoryRadarToPrompt(snapshot: RepositoryRadarSnapshot) {
  if (!snapshot.available) return '';
  const ageHours = Math.max(0, Math.round((Date.now() - Date.parse(snapshot.generatedAt)) / 3_600_000));
  const lines = snapshot.candidates.slice(0, 10).map((item) =>
    `- ${item.fullName} — score ${item.score}/100, ${item.recommendation}; ${item.stars} stars; pushed ${item.pushedAt || 'unknown'}; license ${item.license}; tracks ${item.categories.join(', ')}; URL ${item.url}`,
  );
  return [
    `Repository Intelligence Radar snapshot (${ageHours}h old). This is discovery evidence only; third-party adoption is blocked until reviewed.`,
    ...lines,
  ].join('\n');
}
