import { NextResponse } from 'next/server';
import { getLatestCapacityPlan } from '@/lib/capacity-memory';
import { getCommunicationsSyncSnapshot } from '@/lib/communications-sync';
import { getLatestDailyOperatingPlan } from '@/lib/daily-plan-memory';
import { deviceAgentConfigured, listDeviceCommands } from '@/lib/device-control';
import { ensureBaselineEventStatus, listEventSubscriptions } from '@/lib/event-fabric';
import { getLatestExecutionSchedule } from '@/lib/execution-schedule-memory';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getLatestInterruptSnapshot } from '@/lib/interrupt-memory';
import { getNotificationCenter } from '@/lib/notification-store';
import { getPhoneReadiness } from '@/lib/phone-control';
import { getPlanDiff } from '@/lib/plan-diff';
import { getPortfolioSnapshot } from '@/lib/portfolio-control';
import { listProtectedBlocks } from '@/lib/protected-blocks';
import { getRadarSnapshot } from '@/lib/radar';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';
import { getTaskBoard } from '@/lib/task-router';

export const runtime = 'nodejs';
export const maxDuration = 300;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  await ensureBaselineEventStatus(profile.profileId).catch(() => undefined);
  const [plan, schedule, interrupt, board, portfolio, capacity, relationships, notifications, ledger, radar, diff, protectedBlocks, eventSubscriptions, communications, deviceCommands, phone] = await Promise.all([
    getLatestDailyOperatingPlan(profile.profileId),
    getLatestExecutionSchedule(profile.profileId),
    getLatestInterruptSnapshot(profile.profileId),
    getTaskBoard(profile.profileId),
    getPortfolioSnapshot(profile.profileId),
    getLatestCapacityPlan(profile.profileId),
    getRelationshipSnapshot(profile.profileId),
    getNotificationCenter(profile.profileId),
    getExecutiveLedger(profile.profileId),
    getRadarSnapshot(profile.profileId),
    getPlanDiff(profile.profileId),
    listProtectedBlocks(profile.profileId),
    listEventSubscriptions(profile.profileId),
    getCommunicationsSyncSnapshot(profile.profileId),
    listDeviceCommands(profile.profileId, 30),
    getPhoneReadiness(profile.profileId),
  ]);
  const current = schedule?.currentBlockId ? schedule.blocks.find((block) => block.id === schedule.currentBlockId) : undefined;
  const next = schedule?.nextBlockId ? schedule.blocks.find((block) => block.id === schedule.nextBlockId) : undefined;
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    now: current || null,
    next: next || null,
    plan,
    schedule,
    interrupt,
    board,
    portfolio,
    capacity,
    relationships: {
      generatedAt: relationships.generatedAt,
      relationships: relationships.relationships.filter((item) => item.status !== 'inactive').slice(0, 30),
    },
    notifications: { ...notifications, notifications: notifications.notifications.slice(0, 40) },
    ledger: { ...ledger, items: ledger.items.slice(0, 60) },
    radar: { ...radar, signals: radar.signals.slice(0, 40) },
    diff,
    protectedBlocks: protectedBlocks.slice(0, 100),
    eventSubscriptions,
    communications,
    device: { agentConfigured: deviceAgentConfigured(), commands: deviceCommands },
    phone,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
