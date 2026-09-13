export type InterruptDisposition = 'interrupt_now' | 'queue_after_block' | 'monitor';

export type InterruptPolicyInput = {
  eventScore: number;
  eventSeverity: 'critical' | 'high' | 'normal' | 'low';
  currentBlockScore: number;
  currentBlockKind?: string;
  protectDeepWork: boolean;
  approvalRequired?: boolean;
};

export type InterruptPolicyDecision = {
  disposition: InterruptDisposition;
  margin: number;
  threshold: number;
  reason: string;
};

export function decideInterruption(input: InterruptPolicyInput): InterruptPolicyDecision {
  const eventScore = Math.max(0, Math.min(100, Math.round(input.eventScore)));
  const current = Math.max(0, Math.min(100, Math.round(input.currentBlockScore)));
  const protectedDeepWork = input.protectDeepWork && input.currentBlockKind === 'deep_work';
  const threshold = protectedDeepWork ? 16 : 8;
  const margin = eventScore - current;

  if (input.eventSeverity === 'critical') {
    return { disposition: 'interrupt_now', margin, threshold, reason: 'Critical exception overrides the active focus block.' };
  }
  if (input.eventSeverity === 'high' && margin >= threshold) {
    return { disposition: 'interrupt_now', margin, threshold, reason: protectedDeepWork ? 'High-priority exception materially outranks protected deep work.' : 'High-priority exception materially outranks the active block.' };
  }
  if (input.eventSeverity === 'high' || input.approvalRequired || eventScore >= 60) {
    return { disposition: 'queue_after_block', margin, threshold, reason: 'Important exception is preserved but does not justify breaking the current block.' };
  }
  return { disposition: 'monitor', margin, threshold, reason: 'Exception is not urgent enough to disrupt or immediately queue ahead of planned work.' };
}
