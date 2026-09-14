export type PrincipalRole = 'owner' | 'executive' | 'assistant' | 'operator' | 'viewer';
export type AuthorityCapability =
  | 'read_context'
  | 'manage_tasks'
  | 'manage_calendar'
  | 'send_messages'
  | 'make_calls'
  | 'control_devices'
  | 'manage_integrations'
  | 'manage_authority'
  | 'approve_write'
  | 'approve_high_risk';

export const AUTHORITY_CAPABILITIES: readonly AuthorityCapability[] = [
  'read_context','manage_tasks','manage_calendar','send_messages','make_calls','control_devices','manage_integrations','manage_authority','approve_write','approve_high_risk',
] as const;

export const ROLE_CAPABILITIES: Record<PrincipalRole, readonly AuthorityCapability[]> = {
  owner: AUTHORITY_CAPABILITIES,
  executive: ['read_context','manage_tasks','manage_calendar','send_messages','make_calls','control_devices','approve_write','approve_high_risk'],
  assistant: ['read_context','manage_tasks','manage_calendar','send_messages','make_calls','approve_write'],
  operator: ['read_context','manage_tasks','control_devices'],
  viewer: ['read_context'],
};

export function isPrincipalRole(value: unknown): value is PrincipalRole {
  return typeof value === 'string' && ['owner','executive','assistant','operator','viewer'].includes(value);
}

export function capabilitiesForRole(role: PrincipalRole) {
  return [...ROLE_CAPABILITIES[role]];
}

export function effectiveCapabilities(role: PrincipalRole, requested?: readonly string[]) {
  const allowed = new Set(ROLE_CAPABILITIES[role]);
  if (!requested?.length) return [...allowed];
  return requested.filter((item): item is AuthorityCapability => allowed.has(item as AuthorityCapability));
}

export function hasCapability(role: PrincipalRole, capability: AuthorityCapability, requested?: readonly string[]) {
  return effectiveCapabilities(role, requested).includes(capability);
}

export function requiredApprovalCapability(risk: 'read' | 'write' | 'high'): AuthorityCapability | null {
  if (risk === 'high') return 'approve_high_risk';
  if (risk === 'write') return 'approve_write';
  return null;
}
