import { NextResponse } from 'next/server';
import { getAnticipatorySnapshot, runAnticipatoryScan } from '@/lib/anticipatory-chief-of-staff';
import { getCommitmentFulfilmentSnapshot, runCommitmentFulfilmentCycle } from '@/lib/commitment-fulfilment';
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
  | 'meeting_schedule'
  | 'fulfilment'
  | 'fulfilment_run'
  | 'anticipatory'
  | 'anticipatory_run';

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

function compactFulfilment(records: Awaited<ReturnType<typeof getCommitmentFulfilmentSnapshot>>['records']) {
  return records.slice(0, 10).map((record) => ({
    id: record.id,
    targetType: record.targetType,
    title: record.title,
    status: record.status,
    summary: clip(record.summary, 700),
    question: record.question,
    nextReviewAt: record.nextReviewAt,
  }));
}

function compactForecast(snapshot: Awaited<ReturnType<typeof getAnticipatorySnapshot>>) {
  return snapshot.risks.slice(0, 10).map((item) => ({
    id: item.id,
    type: item.type,
    severity: item.severity,
    title: item.title,
    summary: clip(item.summary, 650),
    recommendedAction: clip(item.recommendedAction, 500),
    horizonHours: item.horizonHours,
    confidence: item.confidence,
  }));
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
    limit?: unknown;
  } | null;

  const command = typeof body?.command === 'string' ? body.command as VoiceCommand : null;
  const allowed = new Set<VoiceCommand>([
    'mission', 'attention', 'daily_briefing', 'meeting_prep', 'radar', 'relationships', 'relationship', 'negotiation', 'ledger', 'commitments', 'command_center', 'meeting_follow_up', 'meeting_schedule', 'fulfilment', 'fulfilment_run', 'anticipatory', 'anticipatory_run',
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

    if (command === 'anticipatory' || command === 'anticipatory_run') {
      const snapshot = command === 'anticipatory_run'
        ? await runAnticipatoryScan({ profileId: profile.profileId, sessionId: `voice-anticipatory-${sessionId}`, timezone, persist: true })
        : await getAnticipatorySnapshot(profile.profileId);
      const risks = compactForecast(snapshot);
      return NextResponse.json({
        ok: true,
        command,
        status: snapshot.stats.critical ? 'critical' : snapshot.stats.high ? 'attention' : 'completed',
        stats: snapshot.stats,
        generatedAt: snapshot.generatedAt,
        risks,
        summary: snapshot.forwardScanSummary ? clip(snapshot.forwardScanSummary, 5000) : undefined,
        ...('createdTasks' in snapshot ? { createdTasks: snapshot.createdTasks } : {}),
      }, { headers: { 'Cache-Control': 'no-store, private' } });
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

    if (command === 'fulfilment' || command === 'fulfilment_run') {
      if (command === 'fulfilment_run') {
        const limit = typeof body?.limit === 'number' && Number.isFinite(body.limit) ? Math.max(1, Math.min(6, Math.round(body.limit))) : 4;
        const cycle = await runCommitmentFulfilmentCycle({ profileId: profile.profileId, sessionPrefix: `voice-fulfilment-${sessionId}`, limit, force: false });
        const pending = cycle.results.find((record) => record.status === 'approval_required' && record.pendingAction);
        return NextResponse.json({
          ok: true,
          command,
          status: pending ? 'approval_required' : cycle.needsInput ? 'needs_input' : cycle.blocked && !cycle.completed ? 'blocked' : 'completed',
          summary: `Reviewed ${cycle.reviewed} obligation${cycle.reviewed === 1 ? '' : 's'}: ${cycle.completed} completed, ${cycle.approvalRequired} awaiting approval, ${cycle.needsInput} needing input, ${cycle.blocked} blocked.`,
          records: compactFulfilment(cycle.results),
          ...(pending?.pendingAction ? { pendingAction: { ...pending.pendingAction, postExecution: { kind: 'commitment-fulfilment', recordId: pending.id } } } : {}),
        }, { headers: { 'Cache-Control': 'no-store, private' } });
      }

      const snapshot = await getCommitmentFulfilmentSnapshot(profile.profileId);
      const live = snapshot.records.filter((record) => record.status !== 'completed');
      const pending = live.find((record) => record.status === 'approval_required' && record.pendingAction);
      return NextResponse.json({
        ok: true,
        command,
        status: pending ? 'approval_required' : live.some((record) => record.status === 'needs_input') ? 'needs_input' : live.length ? 'blocked' : 'completed',
        stats: snapshot.stats,
        records: compactFulfilment(live),
        ...(pending?.pendingAction ? { pendingAction: { ...pending.pendingAction, postExecution: { kind: 'commitment-fulfilment', recordId: pending.id } } } : {}),
      }, { headers: { 'Cache-Control': 'no-store, private' } });
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
