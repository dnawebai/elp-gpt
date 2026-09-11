'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, MonitorSmartphone, Share2, X } from 'lucide-react';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

const INSTALLED_KEY = 'elp-gpt-pwa-installed';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function InstallAppPrompt() {
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const isiOS = useMemo(() => isIOSDevice(), []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.error('ELP GPT service worker registration failed', error);
      });
    }

    if (isStandalone()) {
      try { window.localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
      return;
    }

    try {
      if (window.localStorage.getItem(INSTALLED_KEY) === '1') return;
    } catch {}

    const timer = window.setTimeout(() => setVisible(true), 650);

    const onBeforeInstall = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      setInstallEvent(promptEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      try { window.localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
      setInstallEvent(null);
      setVisible(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) {
      setShowSteps(true);
      return;
    }

    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') {
      try { window.localStorage.setItem(INSTALLED_KEY, '1'); } catch {}
      setVisible(false);
    } else {
      setVisible(false);
    }
    setInstallEvent(null);
  }

  if (!visible) return null;

  return (
    <div className="install-prompt-layer" role="presentation">
      <section className="install-prompt" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <button className="install-close" onClick={() => setVisible(false)} aria-label="Not now">
          <X size={18} />
        </button>

        <div className="install-icon" aria-hidden="true">
          <MonitorSmartphone size={27} />
        </div>

        <div className="install-copy">
          <span className="install-eyebrow">ELP GPT · LUKE</span>
          <h2 id="install-title">Install ELP GPT</h2>
          <p>Add LUKE to your phone, tablet, or desktop for faster access, full-screen use, and one-tap voice.</p>
        </div>

        {(showSteps || isiOS) && (
          <div className="install-steps">
            <Share2 size={17} />
            <p>
              {isiOS
                ? <>Tap <strong>Share</strong>, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</>
                : <>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</>}
            </p>
          </div>
        )}

        <div className="install-actions">
          {!isiOS && (
            <button className="install-primary" onClick={() => void install()}>
              <Download size={17} /> {installEvent ? 'Install app' : 'Install ELP GPT'}
            </button>
          )}
          {isiOS && (
            <button className="install-primary" onClick={() => setShowSteps(true)}>
              <Share2 size={17} /> How to install
            </button>
          )}
          <button className="install-secondary" onClick={() => setVisible(false)}>Not now</button>
        </div>

        <p className="install-note">If you choose “Not now”, this reminder will appear again the next time you open elpgpt.com in a browser.</p>
      </section>
    </div>
  );
}
