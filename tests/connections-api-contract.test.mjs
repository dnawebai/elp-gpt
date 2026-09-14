import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Connected Accounts uses the Composio v3 API independently from tool execution', async () => {
  const connections = await readFile(path.join(root, 'lib/connections.ts'), 'utf8');
  const tools = await readFile(path.join(root, 'lib/composio.ts'), 'utf8');
  assert.match(connections, /DEFAULT_CONNECTIONS_BASE_URL = 'https:\/\/backend\.composio\.dev\/api\/v3'/);
  assert.match(connections, /COMPOSIO_CONNECTIONS_API_URL/);
  assert.doesNotMatch(connections, /COMPOSIO_API_URL \|\| DEFAULT_CONNECTIONS_BASE_URL/);
  assert.match(tools, /DEFAULT_BASE_URL = 'https:\/\/backend\.composio\.dev\/api\/v3\.1'/);
});
