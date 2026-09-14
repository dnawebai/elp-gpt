const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function safeBaseUrl(value) {
  const url = new URL(value || 'https://elpgpt.com');
  if (url.protocol !== 'https:') throw new Error('ELP server must use HTTPS.');
  return url.origin;
}

async function run(file, args) {
  const { stdout, stderr } = await execFileAsync(file, args, { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
  return `${stdout || ''}${stderr || ''}`.trim().slice(0, 1000);
}

async function executeLocal(command) {
  const platform = process.platform;
  switch (command.type) {
    case 'lock_screen':
      if (platform === 'darwin') return run('/usr/bin/pmset', ['displaysleepnow']);
      if (platform === 'win32') return run('rundll32.exe', ['user32.dll,LockWorkStation']);
      return run('loginctl', ['lock-session']);
    case 'open_url': {
      if (!/^https:\/\//i.test(command.target || '')) throw new Error('Rejected non-HTTPS URL.');
      if (platform === 'darwin') return run('/usr/bin/open', [command.target]);
      if (platform === 'win32') return run('powershell.exe', ['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $args[0]', command.target]);
      return run('xdg-open', [command.target]);
    }
    case 'open_app': {
      if (!/^[\w .-]{1,120}$/.test(command.target || '')) throw new Error('Rejected application name.');
      if (platform === 'darwin') return run('/usr/bin/open', ['-a', command.target]);
      if (platform === 'win32') return run('powershell.exe', ['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $args[0]', command.target]);
      return run(command.target, []);
    }
    case 'focus_on':
      if (platform === 'darwin') return run('/usr/bin/shortcuts', ['run', process.env.ELP_FOCUS_ON_SHORTCUT || 'ELP Focus On']);
      throw new Error('Focus-mode actuation requires an OS-specific ELP integration.');
    case 'focus_off':
      if (platform === 'darwin') return run('/usr/bin/shortcuts', ['run', process.env.ELP_FOCUS_OFF_SHORTCUT || 'ELP Focus Off']);
      throw new Error('Focus-mode actuation requires an OS-specific ELP integration.');
    default: throw new Error(`Unsupported device command: ${command.type}`);
  }
}

function createAgent(options) {
  const baseUrl = safeBaseUrl(options.baseUrl);
  const statePath = options.statePath;
  let timer = null;
  let running = false;
  let lastError = '';
  let lastPollAt = '';

  function loadState() {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; }
  }
  function saveState(state) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    try { fs.chmodSync(statePath, 0o600); } catch {}
  }
  function ensureDeviceId(state) {
    if (typeof state.deviceId === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(state.deviceId)) return state.deviceId;
    state.deviceId = `${os.hostname()}-${process.platform}-${crypto.randomUUID().slice(0,8)}`.replace(/[^A-Za-z0-9_-]/g,'-').slice(0,96);
    saveState(state); return state.deviceId;
  }
  async function request(endpoint, init = {}, token) {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...init,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(35000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  async function enroll(enrollmentToken, label) {
    const state = loadState(); const deviceId = ensureDeviceId(state);
    const data = await request('/api/companion/enroll', { method:'POST', body:JSON.stringify({ enrollmentToken, deviceId, label: label || os.hostname(), platform: process.platform, agentVersion:'desktop-0.1.0' }) });
    if (!data.companionToken) throw new Error('Enrollment did not return a companion credential.');
    state.companionToken = data.companionToken; state.principalId = data.principal?.id; state.label = data.device?.label || label || os.hostname(); state.enrolledAt = new Date().toISOString();
    saveState(state); return status();
  }
  async function tick() {
    const state = loadState(); const deviceId = ensureDeviceId(state);
    if (!state.companionToken) return;
    lastPollAt = new Date().toISOString();
    const data = await request(`/api/device-agent?deviceId=${encodeURIComponent(deviceId)}`, {}, state.companionToken);
    for (const command of data.commands || []) {
      let ok=false,result=''; try { result=await executeLocal(command);ok=true; } catch(error){ result=error instanceof Error?error.message:'Device command failed.'; }
      await request('/api/device-agent', { method:'POST', body:JSON.stringify({ commandId:command.id, deviceId, ok, result }) }, state.companionToken);
    }
    lastError = '';
  }
  function start(intervalMs = 15000) {
    if (running) return; running=true;
    const loop = async()=>{ try{await tick();}catch(error){lastError=error instanceof Error?error.message:String(error);} if(running)timer=setTimeout(loop,Math.max(5000,intervalMs));}; void loop();
  }
  function stop(){running=false;if(timer)clearTimeout(timer);timer=null;}
  function signOut(){stop();const state=loadState();delete state.companionToken;delete state.principalId;saveState(state);}
  function status(){const state=loadState();return {baseUrl,deviceId:ensureDeviceId(state),label:state.label||os.hostname(),principalId:state.principalId||null,enrolled:Boolean(state.companionToken),running,lastPollAt,lastError};}
  return { enroll, start, stop, signOut, status };
}

module.exports = { createAgent, executeLocal, safeBaseUrl };
