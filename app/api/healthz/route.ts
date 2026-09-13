import { NextResponse } from 'next/server';
import { getElpSessionSecret } from '@/lib/elp-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

function healthPayload() {
  const checks = {
    identity: configured(getElpSessionSecret()),
    memory: configured(process.env.HONCHO_API_KEY),
    execution: configured(process.env.COMPOSIO_API_KEY),
    voice: configured(process.env.DEEPGRAM_API_KEY),
    reasoning: configured(process.env.HERMES_BASE_URL) || configured(process.env.TOGETHER_API_KEY),
    autonomousJobs: configured(process.env.CRON_SECRET),
  };

  const ready = checks.identity && checks.memory && checks.execution && checks.voice && checks.reasoning;
  const release = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || process.env.NEXT_DEPLOYMENT_ID?.trim() || 'unknown';

  return {
    ok: ready,
    status: ready ? 'ready' : 'degraded',
    service: 'elp-gpt',
    release,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    region: process.env.VERCEL_REGION || process.env.VERCEL_FUNCTION_REGION || 'unknown',
    checks,
    timestamp: new Date().toISOString(),
  };
}

const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function GET() {
  const payload = healthPayload();
  return NextResponse.json(payload, { status: payload.ok ? 200 : 503, headers });
}

export async function HEAD() {
  const payload = healthPayload();
  return new NextResponse(null, { status: payload.ok ? 200 : 503, headers });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers });
}
