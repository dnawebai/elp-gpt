import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import { upsertNotificationCandidates } from '@/lib/notification-store';

export type TelephonyCallAnalysis = {
  callSummary?: string;
  callSuccessful?: boolean;
  userSentiment?: string;
  appointmentBooked?: boolean;
  appointmentDatetime?: string;
  appointmentWith?: string;
  appointmentLocationOrMethod?: string;
  appointmentReference?: string;
  followUpRequired?: boolean;
  followUpNotes?: string;
  callOutcome?: string;
};

export type TelephonyCallRecord = {
  callId: string;
  event: string;
  direction?: string;
  fromNumber?: string;
  toNumber?: string;
  agentId?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  disconnectionReason?: string;
  transcriptPreview?: string;
  analysis?: TelephonyCallAnalysis;
  updatedAt: string;
};

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

async function sessionFor(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const h = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const elp = await h.peer('elp');
  const session = await h.session(`telephony-${profileId}`);
  await session.addPeers([elp]);
  return { elp, session };
}

function parse(m: { metadata: Record<string, unknown> }) {
  if (m.metadata?.elpTelephonyCall !== true || typeof m.metadata.callJson !== 'string') return null;
  try {
    return JSON.parse(m.metadata.callJson) as TelephonyCallRecord;
  } catch {
    return null;
  }
}

function outcomeSummary(input: TelephonyCallRecord) {
  const analysis = input.analysis;
  if (analysis?.appointmentBooked) {
    const when = analysis.appointmentDatetime ? ` for ${analysis.appointmentDatetime}` : '';
    const withWhom = analysis.appointmentWith ? ` with ${analysis.appointmentWith}` : '';
    return `Appointment confirmed${withWhom}${when}.`;
  }
  if (analysis?.callOutcome) {
    return `Call outcome: ${analysis.callOutcome}${analysis.followUpNotes ? ` — ${analysis.followUpNotes}` : ''}.`;
  }
  return `${input.direction || 'phone'} call ${input.callId}${input.disconnectionReason ? ` ended: ${input.disconnectionReason}` : ''}.`;
}

export async function recordTelephonyEvent(profileId: string, input: TelephonyCallRecord) {
  const h = await sessionFor(profileId);
  if (!h) return input;

  await h.session.addMessages([{
    peerId: h.elp.id,
    content: `[TELEPHONY] ${input.event}: ${input.callId}`,
    metadata: {
      elpTelephonyCall: true,
      recordVersion: 2,
      callId: input.callId,
      event: input.event,
      callJson: JSON.stringify(input),
    },
  }]);

  const important = ['call_ended', 'call_analyzed'].includes(input.event);
  if (important) {
    const failed = Boolean(
      input.disconnectionReason && /error|fail|no_answer|busy|invalid|declined/i.test(input.disconnectionReason),
    );
    const appointmentBooked = input.analysis?.appointmentBooked === true;
    await upsertNotificationCandidates(profileId, [{
      fingerprint: `telephony-${input.callId}-${input.event}`,
      kind: 'system',
      severity: failed ? 'high' : 'normal',
      title: appointmentBooked
        ? 'Appointment booked by ELP'
        : input.direction === 'inbound'
          ? 'Inbound call completed'
          : 'ELP call completed',
      summary: outcomeSummary(input).slice(0, 1500),
      source: 'telephony',
      sourceId: input.callId,
      action: appointmentBooked
        ? 'Review the confirmed appointment and add it to the calendar if it is not already present.'
        : input.analysis?.followUpRequired
          ? 'Review the call outcome and complete the required follow-up.'
          : 'Review the call outcome and transcript if needed.',
    }], { resolveMissing: false }).catch(() => undefined);
  }

  return input;
}

export async function listTelephonyCalls(profileId: string, limit = 100) {
  const h = await sessionFor(profileId);
  if (!h) return [] as TelephonyCallRecord[];
  const messages = await listHonchoMessages(h.session, { pageSize: 100, maxPages: 15, reverse: true });
  const latest = new Map<string, TelephonyCallRecord>();
  for (const m of messages) {
    const item = parse(m);
    if (item && !latest.has(item.callId)) latest.set(item.callId, item);
  }
  return [...latest.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(1, Math.min(500, limit)));
}
