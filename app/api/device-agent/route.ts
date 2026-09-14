import { NextResponse } from 'next/server';
import { claimPendingCommands, completeDeviceCommand, verifyDeviceAgentToken } from '@/lib/device-control';
import { getOwnerProfileId } from '@/lib/owner';
import { heartbeatCompanion, verifyCompanionAccess } from '@/lib/principal-authority';
import { bearerToken } from '@/lib/security';

export const runtime = 'nodejs';

async function resolveAgent(request: Request, deviceId: string) {
  const token = bearerToken(request.headers.get('authorization'));
  const companion = await verifyCompanionAccess(token);
  if (companion) {
    if (companion.device.id !== deviceId) return null;
    await heartbeatCompanion(companion.profileId, companion.device.id).catch(() => undefined);
    return { profileId: companion.profileId, allowedCommands: companion.device.allowedCommands, principalId: companion.principal.id, mode: 'companion' as const };
  }
  if (verifyDeviceAgentToken(token)) {
    const profileId = getOwnerProfileId();
    if (!profileId) return null;
    return { profileId, allowedCommands: undefined, principalId: 'principal-owner', mode: 'legacy' as const };
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceId = (url.searchParams.get('deviceId') || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
  if (!deviceId) return NextResponse.json({ error: 'deviceId is required.' }, { status: 400 });
  const agent = await resolveAgent(request, deviceId);
  if (!agent) return NextResponse.json({ error: 'Unauthorized or revoked companion.' }, { status: 401 });
  return NextResponse.json({ commands: await claimPendingCommands(agent.profileId, deviceId, agent.allowedCommands), mode: agent.mode }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const commandId = typeof body?.commandId === 'string' ? body.commandId : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0,96) : '';
  if (!commandId || !deviceId) return NextResponse.json({ error: 'commandId and deviceId are required.' }, { status: 400 });
  const agent = await resolveAgent(request, deviceId);
  if (!agent) return NextResponse.json({ error: 'Unauthorized or revoked companion.' }, { status: 401 });
  try {
    await completeDeviceCommand(agent.profileId, commandId, deviceId, body?.ok === true, typeof body?.result === 'string' ? body.result : undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Device acknowledgement failed.' }, { status: 400 });
  }
}
