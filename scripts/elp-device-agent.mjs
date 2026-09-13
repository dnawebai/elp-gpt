#!/usr/bin/env node
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const baseUrl = (process.env.ELP_DEVICE_SERVER_URL || 'https://elpgpt.com').replace(/\/$/, '');
const token = process.env.ELP_DEVICE_AGENT_TOKEN?.trim();
const deviceId = (process.env.ELP_DEVICE_ID || `${os.hostname()}-${process.platform}`).slice(0, 120);
const intervalMs = Math.max(5_000, Number(process.env.ELP_DEVICE_POLL_MS || 15_000));
if (!token) throw new Error('ELP_DEVICE_AGENT_TOKEN is required.');

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

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
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

console.log(`ELP device agent active as ${deviceId}; polling ${baseUrl}.`);
for (;;) {
  try { await tick(); } catch (error) { console.error('ELP device agent:', error instanceof Error ? error.message : error); }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
