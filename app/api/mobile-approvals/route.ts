import { NextResponse } from 'next/server';
import { approveAndExecuteMobileAction, getMobileApprovalInbox, mobileApprovalConfigured, rejectMobileAction } from '@/lib/mobile-action-approval';
import { heartbeatCompanion, verifyCompanionAccess } from '@/lib/principal-authority';
import { bearerToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 90;

async function companionFrom(request: Request) {
  const companion = await verifyCompanionAccess(bearerToken(request.headers.get('authorization')));
  if (!companion) return null;
  const seen = companion.device.lastSeenAt ? Date.parse(companion.device.lastSeenAt) : 0;
  if (!seen || Date.now() - seen > 60_000) void heartbeatCompanion(companion.profileId, companion.device.id).catch(() => undefined);
  return companion;
}
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store, private' } });
}

export async function GET(request: Request) {
  const companion = await companionFrom(request);
  if (!companion) return reply({ error: 'Active companion credential is required.' }, 401);
  const tickets = await getMobileApprovalInbox(companion.profileId, companion.principal.id);
  return reply({ configured: mobileApprovalConfigured(), tickets, generatedAt: new Date().toISOString() });
}

export async function POST(request: Request) {
  const companion = await companionFrom(request);
  if (!companion) return reply({ error: 'Active companion credential is required.' }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim().slice(0, 96) : '';
  if (!ticketId || !['approve','reject'].includes(action)) return reply({ error: 'A ticketId and approve/reject action are required.' }, 400);
  try {
    if (action === 'reject') {
      return reply(await rejectMobileAction({ profileId: companion.profileId, principalId: companion.principal.id, ticketId, deviceId: companion.device.id }));
    }
    const result = await approveAndExecuteMobileAction({ profileId: companion.profileId, principal: companion.principal, ticketId, deviceId: companion.device.id });
    if (result.status === 'step_up_required') {
      return reply({ ...result, stepUpRequired: true, stepUpMethod: 'passkey', webUrl: 'https://elpgpt.com' }, 428);
    }
    return reply(result);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message.slice(0, 500) : 'Mobile approval failed.' }, 400);
  }
}
