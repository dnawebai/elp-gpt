import { persistTranscript } from '@/lib/memory';
import { runOperatorMission, type OperatorMissionResult, type OperatorMissionState } from '@/lib/operator';

export type BriefingKind = 'daily' | 'attention' | 'meeting-prep';

export type ProactiveBriefing = {
  ok: boolean;
  kind: BriefingKind;
  generatedAt: string;
  timezone: string;
  summary: string;
  status: 'completed' | 'needs_input' | 'blocked';
  trace: OperatorMissionState['trace'];
  observations: OperatorMissionState['observations'];
  question?: string;
};

function localDateLabel(timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function objectiveFor(kind: BriefingKind, timezone: string, meeting?: string) {
  const date = localDateLabel(timezone);
  const readOnly = 'This is a strictly read-only intelligence mission. Never send, create, update, delete, book, publish, deploy, purchase, cancel, or modify anything.';

  if (kind === 'attention') {
    return `Prepare an executive attention radar for ${date} in timezone ${timezone}. ${readOnly}
Review only the minimum connected information needed to identify what requires the principal's attention now: important or unread email, today's and near-term calendar, conflicts, deadlines, unresolved commitments already present in executive memory, and material risks or opportunities. Prioritise urgency and consequence over volume. Ignore newsletters, marketing noise, automated receipts, and low-signal notifications unless they indicate a material issue.
Finish with a concise ranked result using these headings: ACT NOW, TODAY, WAITING ON OTHERS, RISKS, OPPORTUNITIES. State verified facts separately from inference.`;
  }

  if (kind === 'meeting-prep') {
    const target = meeting?.trim()
      ? `The meeting to prepare for is: ${meeting.trim().slice(0, 500)}.`
      : 'Identify the principal\'s next substantive upcoming meeting from the connected calendar and prepare for that meeting.';
    return `Prepare a meeting intelligence brief for ${date} in timezone ${timezone}. ${target} ${readOnly}
Use the calendar to identify the event, timing, attendees and title. Then search only relevant connected email and Drive material needed to understand the relationship, prior commitments, open questions, documents, decisions and likely negotiation points. Do not access unrelated communications. Cross-check with executive memory for commitments and assumptions involving the people or organisation.
Finish with: MEETING, PEOPLE, CONTEXT, OPEN COMMITMENTS, RISKS, QUESTIONS TO ASK, DESIRED OUTCOME, RECOMMENDED OPENING. Distinguish verified facts from inference.`;
  }

  return `Prepare the principal's executive daily briefing for ${date} in timezone ${timezone}. ${readOnly}
Review the minimum connected data needed from Gmail, Google Calendar and Google Drive, plus executive memory. Focus on important unread or recent messages from the last 24-48 hours, today's schedule and the next 24 hours, conflicts or preparation gaps, explicit commitments/deadlines, documents that materially affect today's work, and meaningful risks or opportunities. Suppress newsletters, promotions, routine automated notifications and low-signal activity.
Finish with these headings in this exact order: TOP PRIORITIES, SCHEDULE, MESSAGES REQUIRING ATTENTION, COMMITMENTS, RISKS, OPPORTUNITIES, RECOMMENDED ORDER OF ATTACK. Keep it concise and decision-oriented. Separate verified facts from assumptions or inference.`;
}

async function runReadOnlyMission(args: {
  objective: string;
  profileId: string;
  sessionId: string;
}) {
  let state: OperatorMissionState | null = null;
  let result: OperatorMissionResult | null = null;

  // The operator uses a bounded step budget per call. Briefings may need several
  // connector reads, so allow a small number of resumable rounds without ever
  // crossing the existing write approval boundary.
  for (let round = 0; round < 3; round += 1) {
    result = await runOperatorMission({
      objective: args.objective,
      profileId: args.profileId,
      sessionId: args.sessionId,
      state,
    });
    state = result.state;

    if (result.status === 'completed' || result.status === 'needs_input') return result;
    if (result.status === 'approval_required') {
      return {
        ...result,
        ok: false,
        status: 'blocked' as const,
        summary: 'The proactive briefing attempted to cross a write boundary. No external action was executed.',
        pendingAction: undefined,
      };
    }

    if (!/step limit/i.test(result.summary)) return result;
  }

  return result || {
    ok: false,
    status: 'blocked' as const,
    objective: args.objective,
    summary: 'The briefing could not be completed.',
    state: {
      objective: args.objective,
      iteration: 0,
      discoveries: [],
      observations: [],
      trace: [],
    },
  };
}

export async function generateProactiveBriefing(args: {
  kind: BriefingKind;
  profileId: string;
  sessionId: string;
  timezone?: string;
  meeting?: string;
  persist?: boolean;
}): Promise<ProactiveBriefing> {
  const timezone = args.timezone?.trim() || process.env.LUKE_BRIEFING_TIMEZONE?.trim() || 'America/Toronto';
  const objective = objectiveFor(args.kind, timezone, args.meeting);
  const result = await runReadOnlyMission({
    objective,
    profileId: args.profileId,
    sessionId: args.sessionId,
  });

  const briefing: ProactiveBriefing = {
    ok: result.ok && result.status === 'completed',
    kind: args.kind,
    generatedAt: new Date().toISOString(),
    timezone,
    summary: result.summary,
    status: result.status === 'approval_required' ? 'blocked' : result.status,
    trace: result.state.trace,
    observations: result.state.observations,
    ...(result.question ? { question: result.question } : {}),
  };

  if (args.persist !== false && briefing.summary.trim()) {
    const date = localDateLabel(timezone);
    const session = `briefing-${args.kind}-${date}`;
    await persistTranscript(
      args.profileId,
      session,
      'assistant',
      `[JARBIS ${args.kind.toUpperCase()} BRIEFING]\nGenerated: ${briefing.generatedAt}\nTimezone: ${timezone}\n\n${briefing.summary}`,
    );
  }

  return briefing;
}
