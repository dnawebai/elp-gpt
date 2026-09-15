import './globals.css';
import './reference-hud.css';
import './interaction-dock.css';
import './profile.css';
import './install-prompt.css';
import './retell-call.css';
import './responsive-polish.css';
import './owner-session-gate.css';
import './voice-presence.css';
import type { Metadata, Viewport } from 'next';
import InstallAppPrompt from './InstallAppPrompt';
import OwnerSessionGate from './OwnerSessionGate';
import PasskeyStepUpBridge from './PasskeyStepUpBridge';
import ServiceWorkerRegistration from './ServiceWorkerRegistration';

const SITE_URL = 'https://elpgpt.com';
const TITLE = 'ELP GPT - The Revolution of AGI';
const DESCRIPTION = 'ELP GPT is an Artificial General Intelligence (AGI) system designed to perform intellectual tasks that a human can, combining advanced reasoning, persistent memory, autonomous planning, multimodal interaction, and connected real-world actions.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'ELP GPT',
  keywords: [
    'ELP GPT',
    'AGI',
    'Artificial General Intelligence',
    'general intelligence',
    'autonomous intelligence',
    'AI agent',
    'autonomous AI',
    'AI operator',
    'voice AI',
    'multimodal AI',
    'personal intelligence system',
  ],
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'ELP GPT',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    apple: '/icon-192.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ELP',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#00090b',
};

const webAppSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  '@id': `${SITE_URL}/#app`,
  name: 'ELP GPT',
  alternateName: ['ELP GPT - The Revolution of AGI', 'ELP AI'],
  url: SITE_URL,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: DESCRIPTION,
  featureList: [
    'Artificial General Intelligence-oriented reasoning',
    'Voice-first multimodal AI interaction',
    'Persistent contextual memory',
    'Autonomous planning and reasoning',
    'Connected-tool actions',
    'Permission-gated real-world execution',
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webAppSchema) }}
        />
        <ServiceWorkerRegistration />
        <PasskeyStepUpBridge />
        <OwnerSessionGate />
        {children}
        <InstallAppPrompt />
      </body>
    </html>
  );
}
