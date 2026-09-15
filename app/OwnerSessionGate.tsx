'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { performPasskeyStepUp } from '@/lib/passkey-client';

const AUTH_MESSAGE = 'Hello, Authenticated owner session is required. Verify your passkey to continue.';

type GateState = 'checking' | 'ready' | 'locked' | 'verifying';
type PasskeyStatus = { ownerSessionRequired?: boolean };

export default function OwnerSessionGate() {
  const [state, setState] = useState<GateState>('checking');
  const [notice, setNotice] = useState('');
  const lockedRef = useRef(false);
  const verifyingRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

  const applyDocumentState = useCallback((next: GateState) => {
    document.documentElement.dataset.ownerSession = next;
  }, []);

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const changeState = useCallback((next: GateState) => {
    setState(next);
    applyDocumentState(next);
  }, [applyDocumentState]);

  const readOwnerSession = useCallback(async () => {
    try {
      await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      const response = await fetch('/api/passkeys', { cache: 'no-store' });
      const payload = await response.json().catch(() => null) as PasskeyStatus | null;
      const locked = response.ok && payload?.ownerSessionRequired === true;
      lockedRef.current = locked;
      changeState(locked ? 'locked' : 'ready');
    } catch {
      lockedRef.current = false;
      changeState('ready');
    }
  }, [changeState]);

  useEffect(() => {
    applyDocumentState('checking');
    void readOwnerSession();
    return () => {
      clearNoticeTimer();
      delete document.documentElement.dataset.ownerSession;
    };
  }, [applyDocumentState, clearNoticeTimer, readOwnerSession]);

  const announceAuthentication = useCallback(() => {
    clearNoticeTimer();
    setNotice(AUTH_MESSAGE);

    if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(AUTH_MESSAGE);
        utterance.rate = 0.94;
        utterance.pitch = 0.96;
        window.speechSynthesis.speak(utterance);
      } catch {
        // Visual authentication guidance remains available if browser speech is blocked.
      }
    }
  }, [clearNoticeTimer]);

  const verifyOwner = useCallback(async (target: HTMLButtonElement) => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    announceAuthentication();
    changeState('verifying');

    try {
      await performPasskeyStepUp('authority-management');
      lockedRef.current = false;
      changeState('ready');
      setNotice('Owner verified. ELP is ready.');
      clearNoticeTimer();
      noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2200);
      window.requestAnimationFrame(() => target.click());
    } catch {
      lockedRef.current = true;
      changeState('locked');
      setNotice(AUTH_MESSAGE);
    } finally {
      verifyingRef.current = false;
    }
  }, [announceAuthentication, changeState, clearNoticeTimer]);

  useEffect(() => {
    const interceptProtectedControl = (event: MouseEvent) => {
      if (!lockedRef.current) return;
      const source = event.target;
      if (!(source instanceof Element)) return;
      const target = source.closest('button.hud, button.profile-trigger');
      if (!(target instanceof HTMLButtonElement)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void verifyOwner(target);
    };

    document.addEventListener('click', interceptProtectedControl, true);
    return () => document.removeEventListener('click', interceptProtectedControl, true);
  }, [verifyOwner]);

  if (!notice) return null;

  const verified = state === 'ready';
  return (
    <div className={`owner-session-notice ${state === 'verifying' ? 'is-verifying' : ''} ${verified ? 'is-verified' : ''}`} role="status" aria-live="assertive">
      <span className="owner-session-notice-icon" aria-hidden="true">
        {state === 'verifying' ? <LoaderCircle size={20} /> : verified ? <ShieldCheck size={20} /> : <LockKeyhole size={20} />}
      </span>
      <span className="owner-session-notice-copy">{notice}</span>
      {state === 'verifying' && <span className="owner-session-notice-state">VERIFYING PASSKEY</span>}
    </div>
  );
}
