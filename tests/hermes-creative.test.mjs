import assert from 'node:assert/strict';
import fs from 'node:fs';

const orchestrator = fs.readFileSync(new URL('../lib/hermes-senior-executor.ts', import.meta.url), 'utf8');
const skills = fs.readFileSync(new URL('../lib/creative-skills.ts', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../app/api/hermes-creative/route.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../app/hermes-creative/page.tsx', import.meta.url), 'utf8');

assert.match(orchestrator, /Video-derived pattern:/);
assert.match(orchestrator, /brand brain/i);
assert.match(orchestrator, /competitor/i);
assert.match(orchestrator, /production-ready/i);
assert.match(orchestrator, /COMPOSIO_SEARCH_WEB/);
assert.match(orchestrator, /searchComposioTools/);
assert.match(orchestrator, /Never claim a render or publish completed without verified tool output/i);
assert.match(orchestrator, /must use ELP approval\/standing-authority controls/i);
assert.match(orchestrator, /chief-executor/);
assert.match(orchestrator, /compliance-qa/);
assert.match(orchestrator, /experiment-lead/);

for (const id of [
  'brand-brain',
  'competitor-ad-intelligence',
  'creative-strategy',
  'performance-copy-chief',
  'creative-art-direction',
  'ai-creative-rendering',
  'creative-qa',
  'creative-experiment-design',
  'creative-publishing',
  'senior-hermes-executor',
]) assert.match(skills, new RegExp(id));

assert.match(route, /PROFILE_COOKIE/);
assert.match(route, /verifyProfileToken/);
assert.match(route, /Identity not established/);
assert.match(route, /maxDuration = 90/);
assert.match(route, /private, no-store/);
assert.match(page, /Creative Execution Agent/);
assert.match(page, /Execute mission/);
assert.match(page, /Verified evidence/);
assert.match(page, /Agent swarm/);

console.log('Senior Hermes creative execution checks passed.');
