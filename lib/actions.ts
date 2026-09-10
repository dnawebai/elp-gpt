import { createHash } from 'node:crypto';

export type ActionRisk = 'read' | 'write' | 'high';

const READ_MARKERS = [
  'GET_',
  'LIST_',
  'SEARCH_',
  'FETCH_',
  'FIND_',
  'READ_',
  'LOOKUP_',
  'RETRIEVE_',
  'CHECK_',
  'VIEW_',
  'QUERY_',
];

const HIGH_MARKERS = [
  'DELETE',
  'REMOVE',
  'TRASH',
  'REVOKE',
  'TERMINATE',
  'PURCHASE',
  'PAYMENT',
  'TRANSFER',
  'CHARGE',
  'REFUND',
  'MERGE',
  'DEPLOY',
  'PUBLISH',
  'CANCEL',
  'DISABLE',
  'SECURITY',
  'PASSWORD',
  'PERMISSION',
];

const WRITE_MARKERS = [
  'SEND',
  'CREATE',
  'UPDATE',
  'EDIT',
  'POST',
  'REPLY',
  'FORWARD',
  'INVITE',
  'ADD_',
  'SET_',
  'ARCHIVE',
  'MOVE',
  'RENAME',
  'UPLOAD',
];

export function normalizeToolSlug(value: unknown) {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toUpperCase();
  return /^[A-Z0-9_]{3,160}$/.test(slug) ? slug : null;
}

export function classifyActionRisk(toolSlug: string): ActionRisk {
  const slug = toolSlug.toUpperCase();
  if (HIGH_MARKERS.some((marker) => slug.includes(marker))) return 'high';
  if (WRITE_MARKERS.some((marker) => slug.includes(marker))) return 'write';
  if (READ_MARKERS.some((marker) => slug.includes(marker))) return 'read';
  return 'write';
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

export function actionDigest(input: {
  toolSlug: string;
  arguments: Record<string, unknown>;
  connectedAccountId?: string;
}) {
  return createHash('sha256')
    .update(stable({
      toolSlug: input.toolSlug,
      arguments: input.arguments,
      connectedAccountId: input.connectedAccountId || null,
    }))
    .digest('base64url');
}

export function sanitizeActionArguments(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  if (encoded.length > 64_000) return null;
  return value as Record<string, unknown>;
}

export function approvalCopy(risk: ActionRisk) {
  if (risk === 'high') return 'Explicit approval required before this consequential action can run.';
  if (risk === 'write') return 'Approval required before this action changes an external system.';
  return 'Read-only action. LUKE may execute this when it directly serves the user request.';
}
