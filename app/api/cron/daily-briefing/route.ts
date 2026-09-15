import { NextResponse } from 'next/server';
import { listAutonomousJobRuns, type AutonomousJobRun } from '@/lib/autonomous-jobs';
import { executeComposioTool } from '@/lib/composio';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getBriefingEmailConfig, getBriefingHour, getBriefingTimezone, getOwnerProfileId, localDateParts } from '@/lib/owner';
import { generateProactiveBriefing } from '@/lib/proactive';

export const runtime = 'nodejs';
export const maxDuration = 300;

function recentOvernightRuns(runs: AutonomousJobRun[], now = Date.now()) {
  const cutoff = now - 16 * 60 * 60 * 1000;
  return runs.filter((run) => {
    const timestamp = Date.parse(run.completedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now;
  });
}

function formatRunLines(runs: AutonomousJobRun[], statuses: AutonomousJobRun['status'][]) {
  const matching = runs.filter((run) => statuses.includes(run.status)).slice(0, 12);
  if (!matching.length) return '- None recorded.';
  return matching.map((run) => `- ${run.summary}`).join('\n');
}

function overnightLedger(runs: AutonomousJobRun[]) {
  return [
    'VERIFIED WORK COMPLETED OVERNIGHT',
    formatRunLines(runs, ['completed']),
    '',
    'NEEDS YOUR AUTHORITY OR INPUT',
    formatRunLines(runs, ['approval_required', 'needs_input', 'blocked', 'failed']),
    '',
    'CONDITION WATCHES — NO ACTION REQUIRED',
    formatRunLines(runs, ['condition_not_met']),
  ].join('\n');
}

function emailBody(summary: string, overnight: string, timezone: string, generatedAt: string) {
  return `ELP Executive Daily Briefing\nGenerated: ${generatedAt}\nTimezone: ${timezone}\n\n${overnight}\n\nTODAY'S INTELLIGENCE\n${summary}\n\nExecution claims above come only from the autonomous-job ledger. The intelligence section itself is read-only.`;
}

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: 'Autonomous briefing requires ELP_SINGLE_USER_MODE=true.' },
      { status: 503 },
    );
  }

  const timezone = getBriefingTimezone();
  const targetHour = getBriefingHour();
  const local = localDateParts(timezone);

  // Vercel cron schedules are UTC. The project invokes this route twice daily
  // around the Toronto DST boundary; only the call matching the configured local
  // hour proceeds, so the briefing still lands at the intended local time.
  if (local.hour !== targetHour) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'outside-local-briefing-hour',
      timezone,
      localDate: local.date,
      localHour: local.hour,
      targetHour,
    });
  }

  const [briefing, runs] = await Promise.all([
    generateProactiveBriefing({
      kind: 'daily',
      profileId,
      sessionId: `autonomous-daily-${local.date}`,
      timezone,
      persist: true,
    }),
    listAutonomousJobRuns(profileId, undefined, 100),
  ]);
  const overnightRuns = recentOvernightRuns(runs);
  const overnight = overnightLedger(overnightRuns);

  const delivery = getBriefingEmailConfig();
  let email: { attempted: boolean; sent: boolean; error?: string } = {
    attempted: false,
    sent: false,
  };

  if (delivery.ready) {
    email.attempted = true;
    try {
      await executeComposioTool({
        toolSlug: 'GMAIL_SEND_EMAIL',
        profileId,
        arguments: {
          recipient_email: delivery.recipient,
          subject: `ELP Daily Brief — ${local.date}`,
          body: emailBody(briefing.summary, overnight, timezone, briefing.generatedAt),
          is_html: false,
          user_id: 'me',
        },
      });
      email.sent = true;
    } catch (error) {
      email.error = error instanceof Error ? error.message : 'Email delivery failed.';
    }
  }

  return NextResponse.json({
    ok: briefing.ok,
    briefing,
    overnight: {
      windowHours: 16,
      runCount: overnightRuns.length,
      completed: overnightRuns.filter((run) => run.status === 'completed').length,
      needsAuthorityOrInput: overnightRuns.filter((run) => ['approval_required', 'needs_input', 'blocked', 'failed'].includes(run.status)).length,
      conditionNotMet: overnightRuns.filter((run) => run.status === 'condition_not_met').length,
      summary: overnight,
    },
    email,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
