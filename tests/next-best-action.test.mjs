import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const queue = read('lib/next-best-action.ts');
const route = read('app/api/voice/next-best-actions/route.ts');
const activation = read('app/api/voice/activation-briefing/route.ts');
const memory = read('lib/voice-activation-briefing-memory.ts');
const voice = read('lib/useElpVoice.ts');

test('next-best-action queue exposes the four deterministic recommendation modes', () => {
  assert.match(queue, /NextBestActionMode = 'do_now' \| 'approve' \| 'delegate' \| 'monitor'/);
  assert.match(queue, /mode: 'approve' as const/);
  assert.match(queue, /immediate \? 'do_now' as const : 'monitor' as const/);
  assert.match(queue, /delegate \? 'delegate' : 'monitor'/);
  assert.match(queue, /mode: 'monitor' as const/);
  assert.match(queue, /sort\(\(a, b\) => b\.score - a\.score/);
  assert.match(queue, /slice\(0, MAX_ACTIONS\)/);
});

test('approval recommendations bind to the exact durable continuation and remain explicit approval only', () => {
  assert.match(queue, /sourceKey = `approval:\$\{item\.id\}`/);
  assert.match(queue, /continuationId: item\.id/);
  assert.match(queue, /governance: 'explicit_approval' as const/);
  assert.match(queue, /I will not execute it without your explicit approval/);
});

test('recommendation engine is read-only and does not bypass governed execution', () => {
  assert.doesNotMatch(queue, /executeGovernedAction/);
  assert.doesNotMatch(queue, /planGovernedAction/);
  assert.doesNotMatch(queue, /orchestrateAgentActions/);
  assert.doesNotMatch(route, /executeGovernedAction/);
  assert.doesNotMatch(route, /approveGovernedAction/);
  assert.match(route, /requireZeroTrustAuthority\(request, 'read_context'\)/);
});

test('adaptive memory exposes exact changed keys for focused proactive recommendations', () => {
  assert.match(memory, /changedKeys: string\[\]/);
  assert.match(memory, /resolvedKeys: string\[\]/);
  assert.match(memory, /changedKeys: changedEntries\.map\(\(item\) => item\.key\)/);
  assert.match(activation, /adaptive\.changeState === 'initial' \? undefined : adaptive\.changedKeys/);
  assert.match(activation, /buildNextBestActionQueue\(context, briefing, \{ focusKeys \}\)/);
});

test('activation speaks the highest-value changed recommendation only when the adaptive brief should speak', () => {
  assert.match(activation, /adaptive\.shouldSpeak \? nextBestActionSpeech\(nextBestActions\) : ''/);
  assert.match(activation, /\[adaptive\.speech, recommendation\]\.filter\(Boolean\)\.join\(' '\)/);
  assert.match(activation, /nextBestActions/);
});

test('voice can request the ranked queue but cannot treat it as consent', () => {
  assert.match(voice, /name: 'list_next_best_actions'/);
  assert.match(voice, /fetch\('\/api\/voice\/next-best-actions'/);
  assert.match(voice, /The queue is advisory only and never constitutes consent or execution/);
  assert.match(voice, /require a separate explicit spoken approval before calling approve_pending_approval/);
  assert.match(voice, /write through the existing governed action flow/);
});
