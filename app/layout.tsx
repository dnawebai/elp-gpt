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

export const metadata: Metadata = {
  title: 'LUKE — ELP GPT',
  description: 'A voice-first intelligence system that learns, reasons, speaks and acts with permission.',
  applicationName: 'LUKE',
  manifest: '/manifest.webmanifest',
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <RetellCallDock />
        <InstallAppPrompt />
      </body>
    </html>
  );
}
