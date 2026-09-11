import './globals.css';
import './profile.css';
import './neural-vortex.css';
import './install-prompt.css';
import type { Metadata, Viewport } from 'next';
import NeuralVortexBackdrop from './NeuralVortexBackdrop';
import InstallAppPrompt from './InstallAppPrompt';

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
  themeColor: '#010813',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <NeuralVortexBackdrop />
        {children}
        <InstallAppPrompt />
      </body>
    </html>
  );
}
