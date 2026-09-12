import { NextResponse } from 'next/server';
import { executeComposioTool } from '@/lib/composio';
import { getBriefingEmailConfig, getBriefingHour, getBriefingTimezone, getOwnerProfileId, localDateParts } from '@/lib/owner';
import { generateProactiveBriefing } from '@/lib/proactive';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function emailBody(summary: string, timezone: string, generatedAt: string) {
  return `JARBIS Executive Daily Briefing\nGenerated: ${generatedAt}\nTimezone: ${timezone}\n\n${summary}\n\nThis briefing was generated in read-only mode. No external changes were made.`;
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: 'Autonomous briefing requires LUKE_SINGLE_USER_MODE=true.' },
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

  const briefing = await generateProactiveBriefing({
    kind: 'daily',
    profileId,
    sessionId: `autonomous-daily-${local.date}`,
    timezone,
    persist: true,
  });

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
          subject: `JARBIS Daily Brief — ${local.date}`,
          body: emailBody(briefing.summary, timezone, briefing.generatedAt),
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
    email,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
