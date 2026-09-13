import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('Mission Control calendar writes remain behind signed approval flow', async () => {
  const [page, api] = await Promise.all([
    source('app/mission-control/page.tsx'),
    source('app/api/execution-calendar-actions/route.ts'),
  ]);
  assert.match(api, /GOOGLECALENDAR_CREATE_EVENT/);
  assert.doesNotMatch(api, /executeComposioTool/);
  assert.match(page, /\/api\/actions\/plan/);
  assert.match(page, /\/api\/actions\/approve/);
  assert.match(page, /\/api\/actions\/execute/);
});

test('Google Calendar push webhook authenticates channel and invokes interrupt replanning', async () => {
  const webhook = await source('app/api/webhooks/google-calendar/route.ts');
  assert.match(webhook, /verifyGoogleCalendarWebhook/);
  assert.match(webhook, /runInterruptManager/);
  assert.match(webhook, /x-goog-channel-token/);
});

test('communications webhook is fail-closed behind an ingress bearer token', async () => {
  const webhook = await source('app/api/webhooks/communications/route.ts');
  assert.match(webhook, /timingSafeEqual/);
  assert.match(webhook, /ELP_EVENT_INGRESS_TOKEN/);
  assert.match(webhook, /runInterruptManager/);
});

test('device agent uses a bounded command allowlist and authenticated poll endpoint', async () => {
  const [control, route, agent] = await Promise.all([
    source('lib/device-control.ts'),
    source('app/api/device-agent/route.ts'),
    source('scripts/elp-device-agent.mjs'),
  ]);
  assert.match(control, /focus_on/);
  assert.match(control, /open_url/);
  assert.match(control, /lock_screen/);
  assert.match(route, /verifyDeviceAgentToken/);
  assert.match(agent, /Rejected non-HTTPS URL/);
  assert.doesNotMatch(agent, /exec\(/);
});

test('task model includes structured effort deadlines and execution progress', async () => {
  const tasks = await source('lib/task-router.ts');
  assert.match(tasks, /estimatedHours/);
  assert.match(tasks, /remainingHours/);
  assert.match(tasks, /progressPercent/);
  assert.match(tasks, /dueAt/);
  assert.match(tasks, /progressEvidence/);
});

test('capacity planning consumes structured task effort before heuristic defaults', async () => {
  const planner = await source('lib/resource-capacity-planner.ts');
  assert.match(planner, /task\.remainingHours \?\? task\.estimatedHours/);
  assert.match(planner, /Uses structured task effort/);
});

test('adaptive ranking and strategic simulation both consume outcome calibration', async () => {
  const [priority, strategic] = await Promise.all([
    source('lib/adaptive-priority-engine.ts'),
    source('lib/strategy-score-calibration.ts'),
  ]);
  assert.match(priority, /getStoredStrategyCalibration/);
  assert.match(priority, /resolvedDecisions >= 3/);
  assert.match(strategic, /calibrationWeights/);
  assert.match(strategic, /decisionScore/);
});

test('Mission Control exposes plan movement, protected blocks, event fabric, phone and device control', async () => {
  const api = await source('app/api/mission-control/route.ts');
  for (const symbol of ['getPlanDiff', 'listProtectedBlocks', 'listEventSubscriptions', 'getPhoneReadiness', 'deviceAgentConfigured']) {
    assert.match(api, new RegExp(symbol));
  }
});
