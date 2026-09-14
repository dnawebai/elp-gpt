const fs = require('node:fs');

function createWakeWord(options = {}) {
  let recorder = null; let porcupine = null; let running = false; let loopPromise = null;
  const accessKey = process.env.ELP_WAKE_WORD_ACCESS_KEY || '';
  const keywordPath = process.env.ELP_WAKE_WORD_MODEL_PATH || '';
  async function start() {
    if (running) return { active: true };
    if (!accessKey || !keywordPath || !fs.existsSync(keywordPath)) return { active: false, reason: 'Wake-word key/model is not configured.' };
    let Porcupine, PvRecorder;
    try { ({ Porcupine } = require('@picovoice/porcupine-node')); ({ PvRecorder } = require('@picovoice/pvrecorder-node')); }
    catch { return { active: false, reason: 'Optional wake-word runtime is not installed.' }; }
    porcupine = new Porcupine(accessKey, [keywordPath], [Number(process.env.ELP_WAKE_WORD_SENSITIVITY || 0.6)]);
    recorder = new PvRecorder(porcupine.frameLength, Number(process.env.ELP_WAKE_WORD_DEVICE_INDEX || -1));
    recorder.start(); running = true;
    loopPromise = (async () => { while (running) { try { const pcm = await recorder.read(); const index = porcupine.process(pcm); if (index >= 0) await options.onWake?.(); } catch (error) { if (running) console.error('ELP wake-word loop failed', error); await new Promise((r)=>setTimeout(r,500)); } } })();
    return { active: true };
  }
  async function stop() { running = false; try { recorder?.stop(); recorder?.release(); } catch {} try { porcupine?.release(); } catch {} recorder = null; porcupine = null; await Promise.race([loopPromise || Promise.resolve(), new Promise((r)=>setTimeout(r,500))]); }
  function status() { return { active: running, configured: Boolean(accessKey && keywordPath) }; }
  return { start, stop, status };
}
module.exports = { createWakeWord };
