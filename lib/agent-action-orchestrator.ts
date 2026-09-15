import { classifyActionRisk, type ActionRisk } from '@/lib/actions';
import { executeGovernedAction, planGovernedAction } from '@/lib/action-governor';
import { persistApprovalContinuation } from '@/lib/approval-continuations';
import { isComposioConfigured, searchComposioTools, type ComposioToolSummary } from '@/lib/composio';
import { getReasoningProviders } from '@/lib/reasoning-providers';
import { verifyActionToken } from '@/lib/security';
import type { ActionIntent } from '@/lib/agent-swarm';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type AgentActionResolutionStatus =
  | 'executed'
  | 'approval_required'
  | 'planned'
  | 'needs_input'
  | 'connector_unavailable'
  | 'resolution_failed'
  | 'execution_failed';

export type GovernedAgentAction = {
  intent: ActionIntent;
  status: AgentActionResolutionStatus;
  toolSlug?: string;
  toolName?: string;
  toolkit?: string;
  risk?: ActionRisk;
  arguments?: Record<string, unknown>;
  missingInputs?: string[];
  reason?: string;
  standingAuthorityAuthorized?: boolean;
  standingAuthorityPolicy?: unknown;
  proposalToken?: string;
  executionToken?: string;
  executionResult?: unknown;
  continuationId?: string;
  resumableUntil?: string;
};

export type GovernedAgentActionBatch = {
  configured: boolean;
  attempted: number;
  executed: number;
  approvalRequired: number;
  needsInput: number;
  unresolved: number;
  actions: GovernedAgentAction[];
};

const MAX_ACTIONS = 6;
const SAFE_CONSTANTS = new Set(['me', 'primary', 'true', 'false']);
const SENSITIVE_KEY_PARTS = [
  'email', 'recipient', 'address', 'phone', 'amount', 'price', 'payment', 'account', 'date', 'time',
  'url', 'repo', 'repository', 'branch', 'calendar', 'user_id', 'customer', 'invoice', 'destination', 'source',
];

function clean(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function schemaProperties(schema?: Record<string, unknown>) {
  return asRecord(schema?.properties) || {};
}

function schemaRequired(schema?: Record<string, unknown>) {
  return Array.isArray(schema?.required)
    ? schema.required.filter((value): value is string => typeof value === 'string').slice(0, 40)
    : [];
}

function defaultArguments(schema?: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(schemaProperties(schema))) {
    const property = asRecord(raw);
    if (property && Object.prototype.hasOwnProperty.call(property, 'default')) result[key] = property.default;
  }
  return result;
}

function validatePrimitiveType(value: unknown, expected: unknown) {
  if (typeof expected !== 'string') return true;
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'number' || expected === 'integer') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  return true;
}

function validateArguments(tool: ComposioToolSummary, args: Record<string, unknown>) {
  if (!tool.inputSchema) return { schemaAvailable: false, missing: ['Tool input schema is unavailable.'], invalid: [] as string[] };
  const properties = schemaProperties(tool.inputSchema);
  const missing = schemaRequired(tool.inputSchema).filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const property = asRecord(properties[key]);
    if (!property) continue;
    if (!validatePrimitiveType(value, property.type)) invalid.push(`${key} has the wrong type`);
  }
  return { schemaAvailable: true, missing, invalid };
}

function parseJsonObject(text: string) {
  const direct = text.trim();
  const candidates = [direct, ...[...direct.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim())];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const record = asRecord(parsed);
      if (record) return record;
    } catch {
      continue;
    }
  }
  return null;
}

function sourceContainsValue(sourceText: string, value: unknown) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || SAFE_CONSTANTS.has(normalized)) return true;
    return sourceText.toLowerCase().includes(normalized);
  }
  if (typeof value === 'number') return sourceText.includes(String(value));
  return true;
}

function unsupportedSensitiveValues(args: Record<string, unknown>, sourceText: string) {
  return Object.entries(args)
    .filter(([key, value]) => SENSITIVE_KEY_PARTS.some((marker) => key.toLowerCase().includes(marker)) && !sourceContainsValue(sourceText, value))
    .map(([key]) => key);
}

async function callResolver(system: string, user: string) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider configured for governed action resolution.');
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0,
          max_tokens: 900,
        }),
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 25_000 : 40_000),
      });
      if (!response.ok) {
        failures.push(`${provider.name}:${response.status}`);
        continue;
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
      failures.push(`${provider.name}:empty`);
    } catch (error) {
      failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`);
    }
  }
  throw new Error(`Action resolver providers failed (${failures.join(', ') || 'unknown error'}).`);
}

async function resolveIntent(intent: ActionIntent, objective: string, context: string) {
  const discovered = await searchComposioTools(intent.query, intent.toolkit || undefined);
  if (!discovered.length) return { status: 'connector_unavailable' as const, reason: 'No authorized Composio tool matched this action intent.' };

  const catalog = discovered.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    description: tool.description.slice(0, 900),
    toolkit: tool.toolkit,
    inputSchema: tool.inputSchema || null,
  }));
  const sourceText = `${objective}\n${context}\n${intent.purpose}\n${intent.rationale}\n${JSON.stringify(intent.knownArguments || {})}`;
  const resolvedText = await callResolver(
    'You resolve an ELP action intent to one exact tool from a supplied discovered-tool catalog. You may choose only a listed slug. Build arguments only from facts explicitly present in the objective/context/known arguments, schema defaults, or harmless connector constants such as "me" and "primary". Never invent IDs, email addresses, dates, amounts, account identifiers, URLs, recipients, payment data or other missing facts. If a required value is missing, omit it and list it in missingInputs. Return strict JSON only: {"toolSlug":"...","arguments":{},"missingInputs":[]}.',
    `OBJECTIVE:\n${objective}\n\nCONTEXT:\n${context || 'None'}\n\nACTION INTENT:\n${JSON.stringify(intent)}\n\nDISCOVERED TOOLS:\n${JSON.stringify(catalog).slice(0, 28_000)}`,
  );
  const resolved = parseJsonObject(resolvedText);
  const chosenSlug = clean(resolved?.toolSlug, 160);
  const tool = discovered.find((candidate) => candidate.slug === chosenSlug);
  if (!tool) return { status: 'resolution_failed' as const, reason: 'Resolver did not select one of the discovered tools.' };

  const generatedArgs = asRecord(resolved?.arguments) || {};
  const resolvedArguments = { ...defaultArguments(tool.inputSchema), ...(intent.knownArguments || {}), ...generatedArgs };
  const validation = validateArguments(tool, resolvedArguments);
  const reportedMissing = Array.isArray(resolved?.missingInputs)
    ? resolved.missingInputs.map((value) => clean(value, 160)).filter(Boolean).slice(0, 20)
    : [];
  const unsupported = unsupportedSensitiveValues(resolvedArguments, sourceText);
  const missingInputs = [...new Set([...reportedMissing, ...validation.missing, ...validation.invalid, ...unsupported.map((key) => `${key} is not grounded in supplied context`)])];
  if (!validation.schemaAvailable || missingInputs.length) {
    return {
      status: 'needs_input' as const,
      tool,
      arguments: resolvedArguments,
      missingInputs,
      reason: !validation.schemaAvailable ? 'Tool schema could not be verified, so autonomous planning was stopped.' : 'Required or grounded inputs are missing.',
    };
  }
  return { status: 'resolved' as const, tool, arguments: resolvedArguments };
}

export async function orchestrateAgentActions(args: {
  authority: ZeroTrustAuthorityContext;
  sessionId: string;
  objective: string;
  context?: string;
  intents: ActionIntent[];
  sourceRunId?: string;
  autoExecuteRead?: boolean;
  autoExecuteStandingWrite?: boolean;
}): Promise<GovernedAgentActionBatch> {
  const intents = args.intents.slice(0, MAX_ACTIONS);
  if (!isComposioConfigured()) {
    return {
      configured: false,
      attempted: intents.length,
      executed: 0,
      approvalRequired: 0,
      needsInput: 0,
      unresolved: intents.length,
      actions: intents.map((intent) => ({ intent, status: 'connector_unavailable', reason: 'Composio is not configured.' })),
    };
  }

  const actions: GovernedAgentAction[] = [];
  for (const intent of intents) {
    try {
      const resolved = await resolveIntent(intent, args.objective, args.context || '');
      if (resolved.status !== 'resolved') {
        actions.push({
          intent,
          status: resolved.status,
          ...(resolved.tool ? { toolSlug: resolved.tool.slug, toolName: resolved.tool.name, toolkit: resolved.tool.toolkit } : {}),
          ...(resolved.arguments ? { arguments: resolved.arguments } : {}),
          ...(resolved.missingInputs ? { missingInputs: resolved.missingInputs } : {}),
          reason: resolved.reason,
        });
        continue;
      }

      const risk = classifyActionRisk(resolved.tool.slug);
      const plan = await planGovernedAction(args.authority, {
        sessionId: args.sessionId,
        toolSlug: resolved.tool.slug,
        arguments: resolved.arguments,
        summary: intent.purpose,
      }, { forceExplicitApprovalForHigh: true });
      if (plan.status !== 200) {
        actions.push({
          intent,
          status: 'resolution_failed',
          toolSlug: resolved.tool.slug,
          toolName: resolved.tool.name,
          toolkit: resolved.tool.toolkit,
          risk,
          arguments: resolved.arguments,
          reason: typeof plan.body.error === 'string' ? plan.body.error : 'Action planning failed.',
        });
        continue;
      }

      const proposalToken = typeof plan.body.proposalToken === 'string' ? plan.body.proposalToken : undefined;
      const executionToken = typeof plan.body.executionToken === 'string' ? plan.body.executionToken : undefined;
      const standingAuthorityAuthorized = plan.body.standingAuthorityAuthorized === true;
      const shouldExecuteRead = risk === 'read' && args.autoExecuteRead !== false && proposalToken;
      const shouldExecuteStandingWrite = risk === 'write' && standingAuthorityAuthorized && args.autoExecuteStandingWrite !== false && executionToken;

      if (shouldExecuteRead || shouldExecuteStandingWrite) {
        const execution = await executeGovernedAction(args.authority, {
          token: shouldExecuteRead ? proposalToken : executionToken,
          sessionId: args.sessionId,
          toolSlug: resolved.tool.slug,
          arguments: resolved.arguments,
        });
        actions.push({
          intent,
          status: execution.status === 200 && execution.body.ok === true ? 'executed' : 'execution_failed',
          toolSlug: resolved.tool.slug,
          toolName: resolved.tool.name,
          toolkit: resolved.tool.toolkit,
          risk,
          arguments: resolved.arguments,
          standingAuthorityAuthorized,
          standingAuthorityPolicy: plan.body.standingAuthorityPolicy,
          executionResult: execution.body,
          ...(execution.status !== 200 ? { reason: typeof execution.body.error === 'string' ? execution.body.error : 'Execution failed.' } : {}),
        });
        continue;
      }

      const requiresApproval = plan.body.requiresApproval === true || risk === 'high';
      let continuation: { id: string; expiresAt: string } | null = null;
      if (requiresApproval && proposalToken) {
        const proposal = verifyActionToken(proposalToken);
        if (proposal) {
          continuation = await persistApprovalContinuation(args.authority.profileId, {
            version: 1,
            nonce: proposal.nonce,
            digest: proposal.digest,
            sessionId: proposal.sessionId,
            toolSlug: resolved.tool.slug,
            arguments: resolved.arguments,
            summary: intent.purpose,
            risk: proposal.risk,
            ...(proposal.principalId ? { proposedByPrincipalId: proposal.principalId } : {}),
            source: 'agent',
            ...(args.sourceRunId ? { sourceRunId: args.sourceRunId } : {}),
            createdAt: new Date().toISOString(),
          }).catch(() => null);
        }
      }

      actions.push({
        intent,
        status: requiresApproval ? 'approval_required' : 'planned',
        toolSlug: resolved.tool.slug,
        toolName: resolved.tool.name,
        toolkit: resolved.tool.toolkit,
        risk,
        arguments: resolved.arguments,
        standingAuthorityAuthorized,
        standingAuthorityPolicy: plan.body.standingAuthorityPolicy,
        ...(proposalToken ? { proposalToken } : {}),
        ...(!requiresApproval && executionToken ? { executionToken } : {}),
        ...(continuation ? { continuationId: continuation.id, resumableUntil: continuation.expiresAt } : {}),
        reason: requiresApproval
          ? (continuation
              ? 'Approval is required before execution. This exact action is durably resumable from the approval queue.'
              : (typeof plan.body.policy === 'string' ? plan.body.policy : 'Approval is required before execution.'))
          : 'Action is planned and authorized but was not auto-executed.',
      });
    } catch (error) {
      actions.push({
        intent,
        status: 'resolution_failed',
        reason: error instanceof Error ? error.message : 'Action resolution failed.',
      });
    }
  }

  return {
    configured: true,
    attempted: actions.length,
    executed: actions.filter((action) => action.status === 'executed').length,
    approvalRequired: actions.filter((action) => action.status === 'approval_required').length,
    needsInput: actions.filter((action) => action.status === 'needs_input').length,
    unresolved: actions.filter((action) => ['connector_unavailable', 'resolution_failed', 'execution_failed'].includes(action.status)).length,
    actions,
  };
}

export function summarizeGovernedAgentActions(batch: GovernedAgentActionBatch | null | undefined) {
  if (!batch) return null;
  return {
    configured: batch.configured,
    attempted: batch.attempted,
    executed: batch.executed,
    approvalRequired: batch.approvalRequired,
    needsInput: batch.needsInput,
    unresolved: batch.unresolved,
    actions: batch.actions.map((action) => ({
      purpose: action.intent.purpose,
      status: action.status,
      toolSlug: action.toolSlug,
      toolkit: action.toolkit,
      risk: action.risk,
      missingInputs: action.missingInputs,
      standingAuthorityAuthorized: action.standingAuthorityAuthorized,
      continuationId: action.continuationId,
      resumableUntil: action.resumableUntil,
      reason: action.reason,
    })),
  };
}

export function governedActionExecutionSummary(batch: GovernedAgentActionBatch | null | undefined) {
  if (!batch || !batch.attempted) return '';
  const parts = [
    batch.executed ? `${batch.executed} verified action${batch.executed === 1 ? '' : 's'} executed` : '',
    batch.approvalRequired ? `${batch.approvalRequired} await${batch.approvalRequired === 1 ? 's' : ''} approval in the durable approval queue` : '',
    batch.needsInput ? `${batch.needsInput} need${batch.needsInput === 1 ? 's' : ''} input` : '',
    batch.unresolved ? `${batch.unresolved} unresolved` : '',
  ].filter(Boolean);
  return parts.length ? `Governed execution: ${parts.join('; ')}.` : '';
}
