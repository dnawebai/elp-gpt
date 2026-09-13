import assert from 'node:assert/strict';
import test from 'node:test';
import { decideInterruption } from '../lib/interrupt-policy.ts';

test('critical exceptions always interrupt', () => {
  const decision = decideInterruption({ eventScore: 70, eventSeverity: 'critical', currentBlockScore: 95, currentBlockKind: 'deep_work', protectDeepWork: true });
  assert.equal(decision.disposition, 'interrupt_now');
});

test('protected deep work requires a larger high-priority margin', () => {
  const protectedDecision = decideInterruption({ eventScore: 90, eventSeverity: 'high', currentBlockScore: 80, currentBlockKind: 'deep_work', protectDeepWork: true });
  assert.equal(protectedDecision.disposition, 'queue_after_block');
  assert.equal(protectedDecision.threshold, 16);
  const normalDecision = decideInterruption({ eventScore: 90, eventSeverity: 'high', currentBlockScore: 80, currentBlockKind: 'decision', protectDeepWork: true });
  assert.equal(normalDecision.disposition, 'interrupt_now');
  assert.equal(normalDecision.threshold, 8);
});

test('normal exceptions do not break focus', () => {
  const decision = decideInterruption({ eventScore: 55, eventSeverity: 'normal', currentBlockScore: 60, currentBlockKind: 'deep_work', protectDeepWork: true });
  assert.equal(decision.disposition, 'monitor');
});

test('approval exceptions are queued even when they do not justify interruption', () => {
  const decision = decideInterruption({ eventScore: 58, eventSeverity: 'normal', currentBlockScore: 85, currentBlockKind: 'deep_work', protectDeepWork: true, approvalRequired: true });
  assert.equal(decision.disposition, 'queue_after_block');
});
