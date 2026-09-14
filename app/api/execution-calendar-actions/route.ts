import { NextResponse } from 'next/server';
import { getLatestExecutionSchedule } from '@/lib/execution-schedule-memory';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

function actionFor(block: NonNullable<Awaited<ReturnType<typeof getLatestExecutionSchedule>>>['blocks'][number], timezone: string) {
  return {
    toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
    arguments: {
      calendar_id: 'primary',
      summary: `ELP Focus — ${block.title}`.slice(0, 240),
      description: `Protected by ELP Mission Control. ${block.reason}${block.recommendedAction ? `\n\nObjective: ${block.recommendedAction}` : ''}`.slice(0, 4000),
      start_datetime: block.start,
      end_datetime: block.end,
      timezone,
      transparency: 'opaque',
      visibility: 'private',
      create_meeting_room: false,
      exclude_organizer: true,
      send_updates: 'none',
      extended_properties: { private: { elpBlockId: block.id, elpSource: String(block.source || 'system') } },
    },
    summary: `Protect ${block.title} on Google Calendar from ${block.start} to ${block.end}`,
  };
}

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'manage_calendar');
  if (!context) return NextResponse.json({ error: 'Active principal session with calendar-management permission is required.' }, { status: 403 });
  const schedule = await getLatestExecutionSchedule(context.profileId);
  if (!schedule) return NextResponse.json({ actions: [], schedule: null });
  const url = new URL(request.url); const blockId = url.searchParams.get('blockId');
  const eligible = schedule.blocks.filter((block) => !['prep', 'buffer'].includes(block.kind) && Date.parse(block.end) > Date.now() && (!blockId || block.id === blockId));
  return NextResponse.json({ scheduleId: schedule.id, principalId: context.principal.id, actions: eligible.map((block) => ({ blockId: block.id, block, action: actionFor(block, schedule.timezone) })) }, { headers: { 'Cache-Control': 'no-store, private' } });
}
