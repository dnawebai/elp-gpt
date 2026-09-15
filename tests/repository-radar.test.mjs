import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const radar = fs.readFileSync(new URL('../lib/repository-radar.ts', import.meta.url), 'utf8');
const cron = fs.readFileSync(new URL('../app/api/cron/repository-radar/route.ts', import.meta.url), 'utf8');
const agi = fs.readFileSync(new URL('../lib/agi-core.ts', import.meta.url), 'utf8');
const vercel = fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

test('repository radar scans multiple capability tracks and ranks candidates', () => {
  for (const category of ['orchestration', 'memory', 'computer-use', 'mcp-a2a', 'evaluation', 'coding', 'research']) {
    assert.match(radar, new RegExp(`category: '${category}'`));
  }
  assert.match(radar, /scoreRepository/);
  assert.match(radar, /tractionScore/);
  assert.match(radar, /freshnessScore/);
  assert.match(radar, /score >= 78/);
});

test('radar never treats discovery as permission to adopt third-party code', () => {
  assert.match(radar, /adoptionBlocked: true/);
  assert.match(radar, /Research only — do not install, execute, fork, deploy, or grant permissions/);
  assert.match(cron, /No third-party repository was installed or executed/);
  assert.doesNotMatch(radar, /child_process/);
  assert.doesNotMatch(radar, /execSync/);
  assert.doesNotMatch(radar, /spawn\(/);
});

test('priority repositories create deduplicated internal research tasks only', () => {
  assert.match(radar, /recommendation === 'priority'/);
  assert.match(radar, /repository-radar-\$\{candidateKey/);
  assert.match(radar, /source: 'repository-radar'/);
  assert.match(radar, /approval: 'none'/);
  assert.match(radar, /getTaskBoard/);
});

test('radar state is durable and feeds AGI core reasoning', () => {
  assert.match(radar, /elpRepositoryRadar: true/);
  assert.match(radar, /getRepositoryRadarSnapshot/);
  assert.match(agi, /getRepositoryRadarSnapshot/);
  assert.match(agi, /LIVE REPOSITORY INTELLIGENCE/);
  assert.match(agi, /Repository Intelligence Radar/);
});

test('repository radar runs on an authenticated bounded cron schedule', () => {
  assert.match(cron, /isCronRequestAuthorised/);
  assert.match(cron, /runRepositoryRadar/);
  assert.match(vercel, /\/api\/cron\/repository-radar/);
  assert.match(vercel, /11 \*\/6 \* \* \*/);
});
