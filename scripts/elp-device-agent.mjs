#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const baseUrl = (process.env.ELP_DEVICE_SERVER_URL || 'https://elpgpt.com').replace(/\/$/, '');
const legacyToken = process.env.ELP_DEVICE_AGENT_TOKEN?.trim();
const enrollmentToken = process.env.ELP_COMPANION_ENROLLMENT_TOKEN?.trim();
const deviceId = (process.env.ELP_DEVICE_ID || `${os.hostname()}-${process.platform}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
const deviceLabel = (process.env.ELP_DEVICE_LABEL || os.hostname()).slice(0, 120);
const intervalMs = Math.max(5_000, Number(process.env.ELP_DEVICE_POLL_MS || 15_000));
const tokenFile = process.env.ELP_COMPANION_TOKEN_FILE || path.join(os.homedir(), '.elp', 'companion-token');
let token = process.env.ELP_COMPANION_TOKEN?.trim() || '';

async function run(file, args) {
  const { stdout, stderr } = await execFileAsync(file, args, { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
  return `${stdout || ''}${stderr || ''}`.trim().slice(0, 1000);
}

async function execute(command) {
  const platform = process.platform;
  switch (command.type) {
    case 'lock_screen':
      if (platform === 'darwin') return run('/usr/bin/pmset', ['displaysleepnow']);
      if (platform === 'win32') return run('rundll32.exe', ['user32.dll,LockWorkStation']);
      return run('loginctl', ['lock-session']);
    case 'open_url':
      if (!/^https:\/\//i.test(command.target || '')) throw new Error('Rejected non-HTTPS URL.');
      if (platform === 'darwin') return run('/usr/bin/open', [command.target]);
      if (platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $args[0]', command.target]);
      return run('xdg-open', [command.target]);
    case 'open_app':
      if (!/^[\w .-]{1,120}$/.test(command.target || '')) throw new Error('Rejected application name.');
      if (platform === 'darwin') return run('/usr/bin/open', ['-a', command.target]);
      if (platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $args[0]', command.target]);
      return run(command.target, []);
    case 'focus_on':
      if (platform === 'darwin') return run('/usr/bin/shortcuts', ['run', process.env.ELP_FOCUS_ON_SHORTCUT || 'ELP Focus On']);
      throw new Error('Focus-mode actuation requires a configured OS-specific ELP Focus On integration on this device.');
    case 'focus_off':
      if (platform === 'darwin') return run('/usr/bin/shortcuts', ['run', process.env.ELP_FOCUS_OFF_SHORTCUT || 'ELP Focus Off']);
      throw new Error('Focus-mode actuation requires a configured OS-specific ELP Focus Off integration on this device.');
    default:
      throw new Error(`Unsupported device command: ${command.type}`);
  }
}

async function readPersistedToken() {
  try { return (await readFile(tokenFile, 'utf8')).trim(); } catch { return ''; }
}

async function persistToken(value) {
  await mkdir(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, `${value}\n`, { mode: 0o600 });
  try { await chmod(tokenFile, 0o600); } catch {}
}

async function enroll() {
  if (!enrollmentToken) return '';
  const response = await fetch(`${baseUrl}/api/companion/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enrollmentToken, deviceId, label: deviceLabel, platform: process.platform, agentVersion: '1.0.0' }),
    signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.companionToken) throw new Error(data.error || `Companion enrollment failed (${response.status}).`);
  await persistToken(data.companionToken);
  console.log(`ELP companion enrolled as ${data.device?.label || deviceLabel}.`);
  return data.companionToken;
}

async function ensureToken() {
  if (token) return token;
  token = await readPersistedToken();
  if (token) return token;
  token = await enroll();
  if (token) return token;
  if (legacyToken) { token = legacyToken; return token; }
  throw new Error('Provide ELP_COMPANION_ENROLLMENT_TOKEN once, ELP_COMPANION_TOKEN, or the legacy ELP_DEVICE_AGENT_TOKEN.');
}

async function request(pathname, init = {}) {
  const auth = await ensureToken();
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(35_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function tick() {
  const data = await request(`/api/device-agent?deviceId=${encodeURIComponent(deviceId)}`);
  for (const command of data.commands || []) {
    let ok = false; let result = '';
    try { result = await execute(command); ok = true; }
    catch (error) { result = error instanceof Error ? error.message : 'Device command failed.'; }
    await request('/api/device-agent', { method: 'POST', body: JSON.stringify({ commandId: command.id, deviceId, ok, result }) });
  }
}

await ensureToken();
console.log(`ELP companion active as ${deviceId}; polling ${baseUrl}.`);
for (;;) {
  try { await tick(); } catch (error) { console.error('ELP companion:', error instanceof Error ? error.message : error); }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
