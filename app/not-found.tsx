'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function isStandaloneWebApp() {
  if (typeof window === 'undefined') return false;
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const safariStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneMedia || safariStandalone;
}

export default function NotFound() {
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!isStandaloneWebApp()) return;
    setRecovering(true);
    const timer = window.setTimeout(() => window.location.replace('/'), 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#ffffff', color: '#0b1118', padding: 24 }}>
      <section style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: -2 }}>ELP</div>
        <h1 style={{ margin: '12px 0 8px', fontSize: 24 }}>{recovering ? 'Restoring your ELP session…' : 'This route is no longer available.'}</h1>
        <p style={{ margin: '0 0 18px', color: '#5f6b78', lineHeight: 1.6 }}>
          {recovering
            ? 'Your installed app is using an older saved route. ELP is returning you to the current application.'
            : 'Open the current ELP application from the home screen.'}
        </p>
        <Link href="/" replace style={{ display: 'inline-block', borderRadius: 999, background: '#0b2530', color: '#ffffff', padding: '11px 18px', textDecoration: 'none', fontWeight: 700 }}>
          Open ELP
        </Link>
      </section>
    </main>
  );
}
