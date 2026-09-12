import { NextResponse } from 'next/server';
import { getComposioIdentityHealth, isComposioConfigured } from '@/lib/composio';
import { getDeepgramRuntimeConfig, isDeepgramConfigured, verifyDeepgramConnection } from '@/lib/deepgram';
import { getReasoningProvider } from '@/lib/luke';
import { getSecurityMode } from '@/lib/security';
import { LUKE_SKILLS } from '@/lib/skills';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const provider = getReasoningProvider();
  const config = getDeepgramRuntimeConfig();
  const probeRequested = new URL(request.url).searchParams.get('probe') === '1';
  const deepgram = probeRequested
    ? await verifyDeepgramConnection()
    : {
        configured: isDeepgramConfigured(),
        authenticated: isDeepgramConfigured(),
        latencyMs: null,
        error: null,
      };

  const retellConfigured = Boolean(process.env.RETELL_API_KEY && process.env.RETELL_AGENT_ID);

  const status = {
    voice: deepgram.configured && deepgram.authenticated,
    deepgram,
    retell: retellConfigured,
    retellAgentId: process.env.RETELL_AGENT_ID || null,
    reasoning: Boolean(provider) || deepgram.configured,
    reasoningProvider: provider?.name || (deepgram.configured ? 'deepgram-managed' : null),
    memory: Boolean(process.env.HONCHO_API_KEY),
    hermes: Boolean(process.env.HERMES_BASE_URL),
    together: Boolean(process.env.TOGETHER_API_KEY),
    composio: isComposioConfigured(),
    composioIdentity: getComposioIdentityHealth(),
    securityMode: getSecurityMode(),
    voiceModel: config.voiceModel,
    listenModel: config.listenModel,
    voiceVersion: config.speakVersion,
    listenVersion: config.listenVersion,
    skills: LUKE_SKILLS.length,
    deviceContext: true,
    preciseLocation: 'permission-required',
    outboundCalling: retellConfigured ? 'retell-web-ready' : 'deferred',
  };

  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
