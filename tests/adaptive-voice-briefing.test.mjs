import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const memory = read('lib/voice-activation-briefing-memory.ts');
const route = read('app/api/voice/activation-briefing/route.ts');
const voice = read('lib/useElpVoice.ts');

test('adaptive briefing memory is principal-scoped and persists only acknowledged snapshots', () => {
  assert.match(memory, /voice-activation-memory-\$\{profileId\}/);
  assert.match(memory, /message\.metadata\?\.principalId !== context\.principal\.id/);
  assert.match(memory, /principalId: context\.principal\.id/);
  assert.match(memory, /elpVoiceActivationMemory: true/);
  assert.match(memory, /persistAcknowledged\(context, snapshot\)/);
});

test('unchanged activation state stays silent', () => {
  assert.match(memory, /const shouldSpeak = !previous \|\| changeCount > 0/);
  assert.match(memory, /speech = shouldSpeak \? deltaSpeech/);
  assert.match(memory, /: '';/);
  assert.match(memory, /changeState: !previous \? 'initial' : shouldSpeak \? 'changed' : 'unchanged'/);
});

test('new, escalated, materially changed, resolved, and deadline changes are tracked separately', () => {
  assert.match(memory, /type ChangeKind = 'new' \| 'deadline' \| 'escalated' \| 'changed' \| 'resolved'/);
  assert.match(memory, /if \(!old\)/);
  assert.match(memory, /item\.deadlineBand > old\.deadlineBand/);
  assert.match(memory, /item\.urgency > old\.urgency/);
  assert.match(memory, /item\.signature !== old\.signature/);
  assert.match(memory, /counts\.resolved = resolvedEntries\.length/);
});

test('deadline bands cause re-briefing only at meaningful urgency thresholds', () => {
  assert.match(memory, /remainingMs <= 30 \* 60 \* 1000/);
  assert.match(memory, /remainingMs <= 2 \* 60 \* 60 \* 1000/);
  assert.match(memory, /remainingMs <= 6 \* 60 \* 60 \* 1000/);
  assert.match(memory, /remaining <= 24 \* 60 \* 60 \* 1000/);
  assert.match(memory, /remaining <= 3 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(memory, /remaining <= 7 \* 24 \* 60 \* 60 \* 1000/);
});

test('acknowledgement is sealed, short-lived, and bound to profile and principal', () => {
  assert.match(memory, /ACK_PURPOSE = 'voice-activation-briefing-ack'/);
  assert.match(memory, /ACK_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(memory, /sealServerEnvelope\(/);
  assert.match(memory, /unsealServerEnvelope<BriefingAcknowledgement>/);
  assert.match(memory, /acknowledgement\.profileId !== context\.profileId/);
  assert.match(memory, /acknowledgement\.principalId !== context\.principal\.id/);
});

test('API previews adaptively and acknowledges only on a separate explicit handshake', () => {
  assert.match(route, /prepareAdaptiveVoiceActivationBriefing\(context, briefing\)/);
  assert.match(route, /body\?\.action === 'acknowledge'/);
  assert.match(route, /acknowledgeAdaptiveVoiceActivationBriefing\(context, acknowledgement\)/);
});

test('client acknowledges only after the briefing is actually injected', () => {
  const injectAt = voice.indexOf('session.injectAgentMessage(activationBriefingSpeech)');
  const ackAt = voice.indexOf("body: JSON.stringify({ action: 'acknowledge', acknowledgement })");
  assert.ok(injectAt >= 0 && ackAt > injectAt);
  assert.match(voice, /briefing\?\.shouldSpeak === false/);
  assert.match(voice, /activationBriefingAcknowledgement = briefing\?\.acknowledgement\?\.trim\(\) \|\| ''/);
  assert.match(voice, /userSpokeBeforeBriefing \|\| !activationBriefingSpeech\.trim\(\)/);
});

test('adaptive briefing remains redacted and never stores action arguments or approval execution tokens', () => {
  assert.doesNotMatch(memory, /arguments:/);
  assert.doesNotMatch(memory, /proposalToken/);
  assert.doesNotMatch(memory, /executionToken/);
  assert.doesNotMatch(memory, /transcriptPreview/);
});
