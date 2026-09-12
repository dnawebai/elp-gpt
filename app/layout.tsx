import './globals.css';
import './reference-hud.css';
import './interaction-dock.css';
import './profile.css';
import './install-prompt.css';
import './retell-call.css';
import './responsive-polish.css';
import type { Metadata, Viewport } from 'next';
import InstallAppPrompt from './InstallAppPrompt';
import RetellCallDock from './RetellCallDock';

const SITE_URL = 'https://elpgpt.com';
const TITLE = 'ELP GPT — LUKE AI Voice Assistant & Operator';
const DESCRIPTION = 'ELP GPT is the home of LUKE, a voice-first AI advisor and operator that can reason, remember context, work across connected tools, and execute permission-gated actions.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'LUKE by ELP GPT',
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
      { url: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LUKE',
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
  name: 'LUKE by ELP GPT',
  alternateName: ['ELP GPT', 'LUKE AI'],
  url: SITE_URL,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: DESCRIPTION,
  featureList: [
    'Voice-first AI interaction',
    'Connected-tool actions',
    'Permission-gated execution',
    'Long-term contextual memory',
    'AI operator workflows',
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
        {children}
        <RetellCallDock />
        <InstallAppPrompt />
      </body>
    </html>
  );
}
