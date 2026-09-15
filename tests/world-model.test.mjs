import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('World Model derives from existing durable stores and remains read-only', async () => {
  const model = await source('lib/world-model.ts');
  for (const symbol of ['getPortfolioSnapshot', 'getTaskBoard', 'getExecutiveLedger', 'getRelationshipSnapshot']) {
    assert.match(model, new RegExp(symbol));
  }
  assert.doesNotMatch(model, /updateGoal\(/);
  assert.doesNotMatch(model, /updateTask\(/);
  assert.doesNotMatch(model, /upsertRelationship\(/);
  assert.doesNotMatch(model, /session\.addMessages/);
});

test('World Model distinguishes explicit facts from inferred semantic links', async () => {
  const model = await source('lib/world-model.ts');
  assert.match(model, /source: 'explicit'/);
  assert.match(model, /source: 'inferred'/);
  assert.match(model, /confidence:/);
  assert.match(model, /same_theme/);
  assert.match(model, /related_to/);
});

test('World Model exposes authenticated private API and a dedicated control surface', async () => {
  const [api, page] = await Promise.all([
    source('app/api/world-model/route.ts'),
    source('app/world-model/page.tsx'),
  ]);
  assert.match(api, /verifyProfileToken/);
  assert.match(api, /Cache-Control': 'no-store, private/);
  assert.match(api, /searchWorldModel/);
  assert.match(page, /World Model/);
  assert.match(page, /Inferred links/);
  assert.match(page, /read-only/);
});

test('World Model identifies strategic gaps across goals tasks and relationships', async () => {
  const model = await source('lib/world-model.ts');
  for (const insight of ['orphan_execution', 'goal_without_execution', 'goal_risk', 'relationship_attention', 'strategic_connection']) {
    assert.match(model, new RegExp(insight));
  }
});
