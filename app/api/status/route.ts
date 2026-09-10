import { NextResponse } from 'next/server';
import { getReasoningProvider } from '@/lib/luke';
import { getSecurityMode } from '@/lib/security';

export const runtime = 'nodejs';

export async function GET() {
  const provider = getReasoningProvider();
  const status = {
    voice: Boolean(process.env.DEEPGRAM_API_KEY),
    reasoning: Boolean(provider),
    reasoningProvider: provider?.name || null,
    memory: Boolean(process.env.HONCHO_API_KEY),
    hermes: Boolean(process.env.HERMES_BASE_URL),
    together: Boolean(process.env.TOGETHER_API_KEY),
    securityMode: getSecurityMode(),
    voiceModel: process.env.LUKE_VOICE_MODEL || 'aura-2-jupiter-en',
    listenModel: process.env.LUKE_LISTEN_MODEL || 'flux-general-en',
  };

  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
