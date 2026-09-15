import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const briefing = read('lib/voice-activation-briefing.ts');
const route = read('app/api/voice/activation-briefing/route.ts');
const voice = read('lib/useElpVoice.ts');

test('activation briefing requires zero-trust read authority', () => {
  assert.match(route, /requireZeroTrustAuthority\(request, 'read_context'\)/);
  assert.match(route, /Authenticated read authority is required/);
  assert.match(route, /Cache-Control': 'no-store, private'/);
});

test('activation briefing composes only bounded redacted operational sources', () => {
  assert.match(briefing, /listApprovalContinuations/);
  assert.match(briefing, /getAnticipatorySnapshot/);
  assert.match(briefing, /getExecutiveLedger/);
  assert.match(briefing, /getTaskBoard/);
  assert.match(briefing, /listTelephonyCalls/);
  assert.match(briefing, /MAX_SPEECH = 1400/);
  assert.match(briefing, /appointmentBooked === true/);
  assert.doesNotMatch(briefing, /transcriptPreview/);
  assert.doesNotMatch(briefing, /arguments:/);
  assert.doesNotMatch(briefing, /proposalToken/);
  assert.doesNotMatch(briefing, /executionToken/);
});

test('delegated principals only hear approvals they are authorised to approve', () => {
  assert.match(briefing, /hasCapability\(context\.principal\.role, 'approve_write'/);
  assert.match(briefing, /hasCapability\(context\.principal\.role, 'approve_high_risk'/);
  assert.match(briefing, /item\.risk === 'high' \? canApproveHigh : item\.risk === 'write' \? canApproveWrite : true/);
});

test('voice fetches activation briefing and injects it only after the greeting finishes', () => {
  assert.match(voice, /fetch\('\/api\/voice\/activation-briefing'/);
  assert.match(voice, /session\.injectAgentMessage\(activationBriefingSpeech\)/);
  assert.match(voice, /if \(!initialGreetingDone\)/);
  assert.match(voice, /initialGreetingDone = true/);
  assert.match(voice, /deliverActivationBriefing\(\)/);
});

test('proactive briefing yields to the user and never becomes implicit consent', () => {
  assert.match(voice, /userSpokeBeforeBriefing = true/);
  assert.match(voice, /if \(!initialGreetingDone \|\| activationBriefingSent \|\| userSpokeBeforeBriefing/);
  assert.match(voice, /Explicit spoken/);
  assert.doesNotMatch(voice, /injectUserMessage\(/);
});
