import { getExecutiveLedger, type ExecutiveLedger, type ExecutiveLedgerItem } from '@/lib/executive-memory';
import { getPortfolioSnapshot, type GoalRecord, type PortfolioSnapshot } from '@/lib/portfolio-control';
import { getRelationshipSnapshot, type RelationshipRecord, type RelationshipSnapshot } from '@/lib/relationship-memory';
import { getTaskBoard, type TaskBoard, type TaskRecord } from '@/lib/task-router';

export type WorldNodeKind = 'goal' | 'task' | 'artifact' | 'person' | 'organization';
export type WorldEdgeKind =
  | 'parent_of'
  | 'executes'
  | 'evidenced_by'
  | 'supports'
  | 'implements'
  | 'informs'
  | 'depends_on'
  | 'supersedes'
  | 'member_of'
  | 'delegated_to'
  | 'related_to'
  | 'same_theme';
export type WorldInsightSeverity = 'critical' | 'high' | 'normal' | 'info';

export type WorldNode = {
  id: string;
  kind: WorldNodeKind;
  label: string;
  description?: string;
  status?: string;
  priority?: string;
  source: 'portfolio' | 'tasks' | 'executive_ledger' | 'relationships';
  sourceId: string;
  tags: string[];
};

export type WorldEdge = {
  id: string;
  from: string;
  to: string;
  type: WorldEdgeKind;
  confidence: number;
  source: 'explicit' | 'inferred';
  reason?: string;
};

export type WorldInsight = {
  id: string;
  severity: WorldInsightSeverity;
  kind: 'orphan_execution' | 'goal_without_execution' | 'goal_risk' | 'relationship_attention' | 'strategic_connection';
  title: string;
  summary: string;
  nodeIds: string[];
};

export type WorldModel = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  nodes: WorldNode[];
  edges: WorldEdge[];
  insights: WorldInsight[];
  stats: {
    nodes: number;
    edges: number;
    explicitEdges: number;
    inferredEdges: number;
    goals: number;
    tasks: number;
    artifacts: number;
    people: number;
    organizations: number;
    orphanTasks: number;
    disconnectedGoals: number;
    attentionRelationships: number;
  };
};

export type WorldModelSearch = {
  query: string;
  nodes: WorldNode[];
  edges: WorldEdge[];
};

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'are', 'because', 'before', 'being', 'between', 'but', 'can',
  'company', 'could', 'from', 'goal', 'have', 'into', 'need', 'objective', 'our', 'should', 'that', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'very', 'want', 'will', 'with', 'would', 'your',
  'task', 'decision', 'commitment', 'assumption', 'target', 'today', 'tomorrow', 'user', 'team', 'principal', 'elp',
]);

function clean(value: unknown, max = 4000) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

function slug(value: string, fallback = 'unknown') {
  const normalized = value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (normalized || fallback).slice(0, 96);
}

function unique(values: string[], max = 20) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = clean(raw, 180);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9@.+\s-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.replace(/^-|-$/g, ''))
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function overlap(leftValue: string, rightValue: string) {
  const left = tokens(leftValue);
  const right = tokens(rightValue);
  if (!left.size || !right.size) return { shared: 0, score: 0 };
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  const denominator = Math.max(3, Math.min(left.size, right.size));
  return { shared, score: shared / denominator };
}

function taskList(board: TaskBoard) {
  const all = [
    ...board.queues.now,
    ...board.queues.decisions,
    ...board.queues.working,
    ...board.queues.delegated,
    ...board.queues.done,
  ];
  return all.filter((task, index) => all.findIndex((candidate) => candidate.id === task.id) === index);
}

function goalNodeId(id: string) { return `goal:${id}`; }
function taskNodeId(id: string) { return `task:${id}`; }
function artifactNodeId(id: string) { return `artifact:${id}`; }
function personNodeId(relationship: RelationshipRecord) { return `person:${relationship.key || relationship.id}`; }
function organizationNodeId(name: string) { return `organization:${slug(name)}`; }
function delegateNodeId(name: string) { return `person:delegate:${slug(name)}`; }

function goalText(goal: GoalRecord) {
  return [goal.title, goal.description, goal.metric, goal.unit].filter(Boolean).join(' ');
}

function taskText(task: TaskRecord) {
  return [task.title, task.objective, task.summary, task.progressEvidence, task.note].filter(Boolean).join(' ');
}

function artifactText(item: ExecutiveLedgerItem) {
  return [item.title, item.content, item.owner, item.dependencyText, item.note].filter(Boolean).join(' ');
}

function relationshipText(record: RelationshipRecord) {
  return [
    record.name,
    record.organization,
    record.role,
    ...record.topics,
    ...record.openLoops,
    ...record.promisesByUs,
    ...record.promisesByThem,
    record.nextBestAction,
  ].filter(Boolean).join(' ');
}

export function buildWorldModel(input: {
  portfolio: PortfolioSnapshot;
  board: TaskBoard;
  ledger: ExecutiveLedger;
  relationships: RelationshipSnapshot;
}): WorldModel {
  const { portfolio, board, ledger, relationships } = input;
  const nodes: WorldNode[] = [];
  const edges: WorldEdge[] = [];
  const insights: WorldInsight[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const addNode = (node: WorldNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge: Omit<WorldEdge, 'id'>) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) return;
    const key = `${edge.from}|${edge.type}|${edge.to}`;
    if (edgeIds.has(key)) return;
    edgeIds.add(key);
    edges.push({ ...edge, id: key });
  };

  for (const goal of portfolio.goals) {
    addNode({
      id: goalNodeId(goal.id),
      kind: 'goal',
      label: goal.title,
      ...(goal.description ? { description: goal.description } : {}),
      status: goal.status,
      priority: goal.priority,
      source: 'portfolio',
      sourceId: goal.id,
      tags: unique([goal.level, goal.owner, goal.metric || '', goal.unit || '']),
    });
  }

  const tasks = taskList(board);
  for (const task of tasks) {
    addNode({
      id: taskNodeId(task.id),
      kind: 'task',
      label: task.title,
      description: task.objective,
      status: task.status,
      priority: task.priority,
      source: 'tasks',
      sourceId: task.id,
      tags: unique([task.queue, task.owner, task.approval, task.source, task.toolSlug || '']),
    });
  }

  for (const item of ledger.items) {
    addNode({
      id: artifactNodeId(item.id),
      kind: 'artifact',
      label: item.title,
      description: item.content,
      status: item.status,
      priority: item.priority,
      source: 'executive_ledger',
      sourceId: item.id,
      tags: unique([item.primaryKind, ...item.kinds, item.owner || '', item.dependencyText || '']),
    });
  }

  for (const relationship of relationships.relationships) {
    addNode({
      id: personNodeId(relationship),
      kind: 'person',
      label: relationship.name,
      description: [relationship.organization, relationship.role, relationship.nextBestAction].filter(Boolean).join(' · '),
      status: relationship.momentum,
      priority: relationship.strategicValue,
      source: 'relationships',
      sourceId: relationship.id,
      tags: unique([relationship.organization || '', relationship.role || '', ...relationship.topics, ...relationship.openLoops]),
    });
    if (relationship.organization) {
      addNode({
        id: organizationNodeId(relationship.organization),
        kind: 'organization',
        label: relationship.organization,
        source: 'relationships',
        sourceId: relationship.organization,
        tags: unique(relationship.topics),
      });
    }
  }

  for (const goal of portfolio.goals) {
    if (goal.parentId) addEdge({ from: goalNodeId(goal.parentId), to: goalNodeId(goal.id), type: 'parent_of', confidence: 1, source: 'explicit' });
    for (const taskId of goal.taskIds) addEdge({ from: goalNodeId(goal.id), to: taskNodeId(taskId), type: 'executes', confidence: 1, source: 'explicit' });
    for (const ledgerId of goal.ledgerIds) addEdge({ from: goalNodeId(goal.id), to: artifactNodeId(ledgerId), type: 'evidenced_by', confidence: 1, source: 'explicit' });
  }

  for (const edge of ledger.edges) {
    const type = edge.type as WorldEdgeKind;
    if (!['supports', 'implements', 'informs', 'depends_on', 'supersedes'].includes(type)) continue;
    addEdge({
      from: artifactNodeId(edge.from),
      to: artifactNodeId(edge.to),
      type,
      confidence: Math.max(0, Math.min(1, edge.score)),
      source: 'explicit',
    });
  }

  for (const relationship of relationships.relationships) {
    if (!relationship.organization) continue;
    addEdge({
      from: personNodeId(relationship),
      to: organizationNodeId(relationship.organization),
      type: 'member_of',
      confidence: Math.max(0.7, relationship.confidence),
      source: 'explicit',
    });
  }

  const normalizedRelationships = relationships.relationships.map((relationship) => ({
    relationship,
    match: [relationship.name, relationship.email, relationship.organization].filter(Boolean).join(' ').toLowerCase(),
  }));
  for (const delegation of portfolio.delegations) {
    const delegatee = clean(delegation.delegatee, 300);
    if (!delegatee) continue;
    const needle = delegatee.toLowerCase();
    const relationshipMatch = normalizedRelationships.find(({ match }) => match.includes(needle) || needle.includes(match));
    const target = relationshipMatch ? personNodeId(relationshipMatch.relationship) : delegateNodeId(delegatee);
    if (!relationshipMatch) {
      addNode({
        id: target,
        kind: 'person',
        label: delegatee,
        description: clean(delegation.expectedOutcome, 500),
        status: delegation.status,
        source: 'portfolio',
        sourceId: delegation.id,
        tags: unique(['delegatee', delegation.channel || '']),
      });
    }
    addEdge({ from: taskNodeId(delegation.taskId), to: target, type: 'delegated_to', confidence: 1, source: 'explicit' });
    if (delegation.goalId) addEdge({ from: goalNodeId(delegation.goalId), to: target, type: 'delegated_to', confidence: 0.95, source: 'explicit', reason: 'Portfolio delegation is attached to this goal.' });
  }

  const explicitlyLinkedTasks = new Set(edges.filter((edge) => edge.type === 'executes').map((edge) => edge.to));
  for (const goal of portfolio.goals.filter((item) => item.status === 'active' || item.status === 'at_risk')) {
    for (const task of tasks.filter((item) => item.status === 'active' || item.status === 'blocked')) {
      if (explicitlyLinkedTasks.has(taskNodeId(task.id))) continue;
      const relation = overlap(goalText(goal), taskText(task));
      if (relation.shared < 2 || relation.score < 0.34) continue;
      addEdge({
        from: goalNodeId(goal.id),
        to: taskNodeId(task.id),
        type: 'same_theme',
        confidence: Math.min(0.82, 0.46 + relation.score),
        source: 'inferred',
        reason: `${relation.shared} material terms overlap between goal and task.`,
      });
    }
  }

  for (const goal of portfolio.goals.filter((item) => item.status === 'active' || item.status === 'at_risk')) {
    for (const item of ledger.items.filter((record) => record.status === 'active' || record.status === 'blocked')) {
      const relation = overlap(goalText(goal), artifactText(item));
      if (relation.shared < 2 || relation.score < 0.32) continue;
      addEdge({
        from: goalNodeId(goal.id),
        to: artifactNodeId(item.id),
        type: 'same_theme',
        confidence: Math.min(0.8, 0.44 + relation.score),
        source: 'inferred',
        reason: `${relation.shared} material terms overlap between goal and executive artifact.`,
      });
    }
  }

  const strategicNodes = [
    ...portfolio.goals.filter((item) => !['achieved', 'cancelled'].includes(item.status)).map((item) => ({ id: goalNodeId(item.id), text: goalText(item) })),
    ...tasks.filter((item) => !['completed', 'cancelled'].includes(item.status)).map((item) => ({ id: taskNodeId(item.id), text: taskText(item) })),
    ...ledger.items.filter((item) => !['completed', 'dismissed', 'superseded'].includes(item.status)).map((item) => ({ id: artifactNodeId(item.id), text: artifactText(item) })),
  ];
  for (const relationship of relationships.relationships.filter((item) => item.status !== 'inactive')) {
    const right = relationshipText(relationship);
    for (const left of strategicNodes) {
      const relation = overlap(left.text, right);
      if (relation.shared < 2 || relation.score < 0.3) continue;
      addEdge({
        from: left.id,
        to: personNodeId(relationship),
        type: 'related_to',
        confidence: Math.min(0.78, 0.42 + relation.score),
        source: 'inferred',
        reason: `${relation.shared} material terms connect the work item to this relationship.`,
      });
    }
  }

  const goalTaskEdges = edges.filter((edge) => edge.type === 'executes' || (edge.type === 'same_theme' && edge.from.startsWith('goal:') && edge.to.startsWith('task:')));
  const linkedTaskIds = new Set(goalTaskEdges.map((edge) => edge.to));
  const orphanTasks = tasks.filter((task) => !['completed', 'cancelled'].includes(task.status) && !linkedTaskIds.has(taskNodeId(task.id)));
  for (const task of orphanTasks.slice(0, 12)) {
    insights.push({
      id: `orphan:${task.id}`,
      severity: task.priority === 'critical' ? 'critical' : task.priority === 'high' ? 'high' : 'normal',
      kind: 'orphan_execution',
      title: 'Execution is not tied to a strategic goal',
      summary: `${task.title} is active but has no explicit or strong inferred goal link.`,
      nodeIds: [taskNodeId(task.id)],
    });
  }

  const disconnectedGoals = portfolio.goals.filter((goal) => {
    if (goal.status !== 'active' || goal.level === 'vision') return false;
    const id = goalNodeId(goal.id);
    return !edges.some((edge) => edge.from === id && ['executes', 'evidenced_by', 'same_theme'].includes(edge.type));
  });
  for (const goal of disconnectedGoals.slice(0, 12)) {
    insights.push({
      id: `goal-gap:${goal.id}`,
      severity: goal.priority === 'critical' ? 'critical' : goal.priority === 'high' ? 'high' : 'normal',
      kind: 'goal_without_execution',
      title: 'Goal has no execution path',
      summary: `${goal.title} is active but has no linked task or executive artifact.`,
      nodeIds: [goalNodeId(goal.id)],
    });
  }

  for (const health of portfolio.goalHealth.filter((item) => item.health === 'critical' || item.health === 'at_risk')) {
    insights.push({
      id: `goal-risk:${health.goal.id}`,
      severity: health.health === 'critical' ? 'critical' : 'high',
      kind: 'goal_risk',
      title: `${health.goal.title} is ${health.health.replace('_', ' ')}`,
      summary: health.reasons.slice(0, 3).join(' '),
      nodeIds: [goalNodeId(health.goal.id)],
    });
  }

  const attentionRelationships = relationships.relationships.filter((relationship) =>
    relationship.status !== 'inactive'
    && (relationship.strategicValue === 'critical' || relationship.strategicValue === 'high')
    && (relationship.momentum === 'cooling' || relationship.momentum === 'stalled' || relationship.openLoops.length > 0),
  );
  for (const relationship of attentionRelationships.slice(0, 12)) {
    insights.push({
      id: `relationship:${relationship.key}`,
      severity: relationship.strategicValue === 'critical' && relationship.momentum === 'stalled' ? 'critical' : 'high',
      kind: 'relationship_attention',
      title: `${relationship.name} needs attention`,
      summary: relationship.nextBestAction || `${relationship.openLoops.length} open loop${relationship.openLoops.length === 1 ? '' : 's'}; momentum is ${relationship.momentum}.`,
      nodeIds: [personNodeId(relationship)],
    });
  }

  for (const edge of edges.filter((item) => item.source === 'inferred' && item.type === 'related_to' && item.confidence >= 0.67).slice(0, 12)) {
    const left = nodes.find((node) => node.id === edge.from);
    const right = nodes.find((node) => node.id === edge.to);
    if (!left || !right) continue;
    insights.push({
      id: `connection:${edge.id}`,
      severity: 'info',
      kind: 'strategic_connection',
      title: `Possible strategic connection: ${left.label} ↔ ${right.label}`,
      summary: edge.reason || 'ELP detected a strong cross-domain relationship.',
      nodeIds: [left.id, right.id],
    });
  }

  const severityRank: Record<WorldInsightSeverity, number> = { critical: 4, high: 3, normal: 2, info: 1 };
  insights.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || a.title.localeCompare(b.title));
  nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  edges.sort((a, b) => Number(b.source === 'explicit') - Number(a.source === 'explicit') || b.confidence - a.confidence);

  const configured = portfolio.configured || board.configured || ledger.configured || relationships.configured;
  return {
    configured,
    available: nodes.length > 0,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    insights,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      explicitEdges: edges.filter((edge) => edge.source === 'explicit').length,
      inferredEdges: edges.filter((edge) => edge.source === 'inferred').length,
      goals: nodes.filter((node) => node.kind === 'goal').length,
      tasks: nodes.filter((node) => node.kind === 'task').length,
      artifacts: nodes.filter((node) => node.kind === 'artifact').length,
      people: nodes.filter((node) => node.kind === 'person').length,
      organizations: nodes.filter((node) => node.kind === 'organization').length,
      orphanTasks: orphanTasks.length,
      disconnectedGoals: disconnectedGoals.length,
      attentionRelationships: attentionRelationships.length,
    },
  };
}

export async function getWorldModel(profileId: string): Promise<WorldModel> {
  const [portfolio, board, ledger, relationships] = await Promise.all([
    getPortfolioSnapshot(profileId),
    getTaskBoard(profileId),
    getExecutiveLedger(profileId),
    getRelationshipSnapshot(profileId),
  ]);
  return buildWorldModel({ portfolio, board, ledger, relationships });
}

export function searchWorldModel(model: WorldModel, query: string, limit = 40): WorldModelSearch {
  const normalized = clean(query, 240).toLowerCase();
  if (!normalized) return { query: '', nodes: model.nodes.slice(0, limit), edges: [] };
  const queryTokens = [...tokens(normalized)];
  const ranked = model.nodes
    .map((node) => {
      const haystack = [node.label, node.description, node.kind, node.status, node.priority, ...node.tags].filter(Boolean).join(' ').toLowerCase();
      let score = haystack.includes(normalized) ? 10 : 0;
      if (node.label.toLowerCase() === normalized) score += 20;
      if (node.label.toLowerCase().startsWith(normalized)) score += 8;
      score += queryTokens.filter((token) => haystack.includes(token)).length * 2;
      return { node, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
    .slice(0, Math.max(1, Math.min(100, limit)));
  const matched = new Set(ranked.map((entry) => entry.node.id));
  const edges = model.edges.filter((edge) => matched.has(edge.from) || matched.has(edge.to)).slice(0, 120);
  const connectedIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const connected = model.nodes.filter((node) => connectedIds.has(node.id) && !matched.has(node.id)).slice(0, 20);
  return { query: normalized, nodes: [...ranked.map((entry) => entry.node), ...connected], edges };
}

export function worldModelToPrompt(model: WorldModel) {
  if (!model.available) return '';
  const critical = model.insights.filter((item) => item.severity === 'critical' || item.severity === 'high').slice(0, 8);
  const topGoals = model.nodes.filter((node) => node.kind === 'goal' && !['achieved', 'cancelled'].includes(node.status || '')).slice(0, 8);
  const topPeople = model.nodes.filter((node) => node.kind === 'person' && (node.priority === 'critical' || node.priority === 'high')).slice(0, 8);
  return [
    `Operational world model: ${model.stats.nodes} nodes, ${model.stats.edges} links, ${model.stats.orphanTasks} orphan tasks, ${model.stats.disconnectedGoals} goals without execution.`,
    topGoals.length ? `Active strategic goals:\n${topGoals.map((node) => `- ${node.label} [${node.status || 'active'}]`).join('\n')}` : '',
    critical.length ? `Cross-domain attention:\n${critical.map((item) => `- ${item.title}: ${item.summary}`).join('\n')}` : '',
    topPeople.length ? `High-value relationships:\n${topPeople.map((node) => `- ${node.label}${node.description ? ` — ${node.description}` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
