import { NextResponse } from 'next/server';
import { getApprovalLedger } from '@/lib/approval-ledger';
import { isComposioConfigured } from '@/lib/composio';
import { getReasoningProviders } from '@/lib/luke';
import { getNotificationCenter } from '@/lib/notifications';
import { getRadarSnapshot } from '@/lib/radar';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { PROFILE_COOKIE, getSecurityMode, verifyProfileToken } from '@/lib/security';
import { getTaskBoard } from '@/lib/task-router';

export const runtime = 'nodejs';
export const maxDuration = 120;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const [tasks, approvals, radar, relationships, notifications] = await Promise.all([
    getTaskBoard(profile.profileId),
    getApprovalLedger(profile.profileId),
    getRadarSnapshot(profile.profileId),
    getRelationshipSnapshot(profile.profileId),
    getNotificationCenter(profile.profileId),
  ]);
  const providers = getReasoningProviders().map((provider) => provider.name);

  const health = {
    ok: true,
    generatedAt: new Date().toISOString(),
    securityMode: getSecurityMode(),
    services: {
      honcho: Boolean(process.env.HONCHO_API_KEY),
      composio: isComposioConfigured(),
      deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
      hermes: providers.includes('hermes'),
      together: providers.includes('together'),
      retell: Boolean(process.env.RETELL_API_KEY && process.env.RETELL_AGENT_ID),
      cron: Boolean(process.env.CRON_SECRET),
    },
    queues: {
      now: tasks.queues.now.length,
      decisions: tasks.queues.decisions.length,
      working: tasks.queues.working.length,
      delegated: tasks.queues.delegated.length,
      done: tasks.queues.done.length,
    },
    approvals: approvals.stats,
    radar: radar.stats,
    relationships: relationships.stats,
    notifications: notifications.stats,
    lastRuns: {
      radar: radar.lastScan || null,
      relationships: relationships.lastScan || null,
    },
  };

  return NextResponse.json(health, { headers: { 'Cache-Control': 'no-store, private' } });
}
