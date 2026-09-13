import { NextResponse } from 'next/server';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { prepareVoiceMeetingCalendar, prepareVoiceMeetingEmail } from '@/lib/meeting-voice-actions';
import { prepareNegotiationBrief } from '@/lib/relationship-intelligence';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { runOperatorMission } from '@/lib/operator';
import { generateProactiveBriefing } from '@/lib/proactive';
import { getRadarSnapshot } from '@/lib/radar';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';
import { getTaskBoard } from '@/lib/task-router';

export const runtime = 'nodejs';
export const maxDuration = 300;

type VoiceCommand =
  | 'mission'
  | 'attention'
  | 'daily_briefing'
  | 'meeting_prep'
  | 'radar'
  | 'relationships'
  | 'relationship'
  | 'negotiation'
  | 'ledger'
  | 'commitments'
  | 'command_center'
  | 'meeting_follow_up'
  | 'meeting_schedule';

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

function clip(value: string, max = 5000) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function compactLedger(kind?: 'commitment') {
  return async (profileId: string) => {
    const ledger = await getExecutiveLedger(profileId);
    const items = ledger.items
      .filter((item) => item.status === 'active' || item.status === 'blocked')
      .filter((item) => !kind || item.primaryKind === kind)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.priority === 'high') - Number(a.priority === 'high'))
      .slice(0, 12)
      .map((item) => ({
        id: item.id,
        kind: item.primaryKind,
        title: item.title,
        status: item.status,
        owner: item.owner,
        dueDate: item.dueDate,
        priority: item.priority,
        overdue: item.overdue,
        stale: item.stale,
      }));
    return { ok: true, stats: ledger.stats, items };
  };
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    command?: unknown;
    sessionId?: unknown;
    objective?: unknown;
    target?: unknown;
    context?: unknown;
    meeting?: unknown;
    timezone?: unknown;
    query?: unknown;
    followUpNumber?: unknown;
    scheduleRequest?: unknown;
    durationMinutes?: unknown;
    inviteParticipants?: unknown;
  } | null;

  const command = typeof body?.command === 'string' ? body.command as VoiceCommand : null;
  const allowed = new Set<VoiceCommand>([
    'mission', 'attention', 'daily_briefing', 'meeting_prep', 'radar', 'relationships', 'relationship', 'negotiation', 'ledger', 'commitments', 'command_center', 'meeting_follow_up', 'meeting_schedule',
  ]);
  if (!command || !allowed.has(command)) return NextResponse.json({ error: 'Unsupported JARBIS voice command.' }, { status: 400 });

  const sessionId = sanitizeId(body?.sessionId, 'voice');
  const objective = typeof body?.objective === 'string' ? clip(body.objective, 4000) : '';
  const target = typeof body?.target === 'string' ? clip(body.target, 300) : '';
  const context = typeof body?.context === 'string' ? clip(body.context, 5000) : '';
  const meeting = typeof body?.meeting === 'string' ? clip(body.meeting, 500) : '';
  const timezone = typeof body?.timezone === 'string' ? clip(body.timezone, 100) : undefined;
  const query = typeof body?.query === 'string' ? body.query.trim().toLowerCase() : '';

  try {
    if (command === 'mission') {
      if (!objective) return NextResponse.json({ error: 'Mission objective is required.' }, { status: 400 });
      const result = await runOperatorMission({ objective, profileId: profile.profileId, sessionId, state: null });
      return NextResponse.json({ ok: result.ok, command, status: result.status, summary: result.summary, question: result.question, pendingAction: result.pendingAction }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'meeting_follow_up') {
      const meetingReference = meeting || target || 'latest';
      const followUpNumber = typeof body?.followUpNumber === 'number' && Number.isFinite(body.followUpNumber) ? Math.max(1, Math.round(body.followUpNumber)) : 1;
      const pendingAction = await prepareVoiceMeetingEmail(profile.profileId, meetingReference, followUpNumber, timezone);
      return NextResponse.json({ ok: true, command, status: 'approval_required', summary: pendingAction.summary, pendingAction }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'meeting_schedule') {
      const meetingReference = meeting || target || 'latest';
      const scheduleRequest = typeof body?.scheduleRequest === 'string' ? clip(body.scheduleRequest, 1200) : objective;
      if (!scheduleRequest) return NextResponse.json({ error: 'A follow-up date/time is required.' }, { status: 400 });
      const pendingAction = await prepareVoiceMeetingCalendar(profile.profileId, {
        meetingReference,
        scheduleRequest,
        timezone,
        durationMinutes: typeof body?.durationMinutes === 'number' ? body.durationMinutes : undefined,
        inviteParticipants: body?.inviteParticipants !== false,
      });
      return NextResponse.json({ ok: true, command, status: 'approval_required', summary: pendingAction.summary, pendingAction }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'attention' || command === 'daily_briefing' || command === 'meeting_prep') {
      const briefing = await generateProactiveBriefing({
        kind: command === 'attention' ? 'attention' : command === 'meeting_prep' ? 'meeting-prep' : 'daily',
        profileId: profile.profileId,
        sessionId,
        timezone,
        meeting: meeting || undefined,
        persist: true,
      });
      return NextResponse.json({ ok: briefing.ok, command, status: briefing.status, summary: clip(briefing.summary, 7000), question: briefing.question }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'radar') {
      const radar = await getRadarSnapshot(profile.profileId);
      const signals = radar.signals.filter((signal) => signal.status === 'open' || signal.status === 'acknowledged').slice(0, 10).map((signal) => ({
        type: signal.type, severity: signal.severity, title: signal.title, summary: signal.summary, recommendedAction: signal.recommendedAction, confidence: signal.confidence,
      }));
      return NextResponse.json({ ok: true, command, stats: radar.stats, signals, lastScan: radar.lastScan }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'relationships' || command === 'relationship') {
      const snapshot = await getRelationshipSnapshot(profile.profileId);
      let records = snapshot.relationships;
      if (command === 'relationship' && (target || query)) {
        const needle = (target || query).toLowerCase();
        records = records.filter((record) => [record.name, record.organization || '', record.email || ''].some((value) => value.toLowerCase().includes(needle)));
      }
      const relationships = records.slice(0, 10).map((record) => ({
        id: record.id, name: record.name, organization: record.organization, role: record.role, strategicValue: record.strategicValue, momentum: record.momentum, lastInteractionAt: record.lastInteractionAt,
        openLoops: record.openLoops.slice(0, 5), promisesByUs: record.promisesByUs.slice(0, 4), promisesByThem: record.promisesByThem.slice(0, 4), objections: record.objections.slice(0, 4), nextBestAction: record.nextBestAction, confidence: record.confidence,
      }));
      return NextResponse.json({ ok: true, command, stats: snapshot.stats, relationships }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'negotiation') {
      if (!target) return NextResponse.json({ error: 'Negotiation target is required.' }, { status: 400 });
      const brief = await prepareNegotiationBrief({ profileId: profile.profileId, target, objective: objective || undefined, context: context || undefined });
      return NextResponse.json({ ok: true, command, target: brief.target, summary: clip(brief.brief, 10000) }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (command === 'ledger') {
      const result = await compactLedger()(profile.profileId);
      return NextResponse.json({ command, ...result }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (command === 'commitments') {
      const result = await compactLedger('commitment')(profile.profileId);
      return NextResponse.json({ command, ...result }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    const board = await getTaskBoard(profile.profileId);
    return NextResponse.json({ ok: true, command, total: board.total, queues: {
      now: board.queues.now.slice(0, 8), decisions: board.queues.decisions.slice(0, 8), working: board.queues.working.slice(0, 8), delegated: board.queues.delegated.slice(0, 8), done: board.queues.done.slice(0, 5),
    } }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Unified JARBIS voice command failed', { command, error });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'JARBIS voice command failed.' }, { status: 500 });
  }
}
