import { NextResponse } from 'next/server';
import { claimPendingCommands, completeDeviceCommand, verifyDeviceAgentToken } from '@/lib/device-control';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';

function agentToken(request: Request) { const header = request.headers.get('authorization') || ''; const match = header.match(/^Bearer\s+(.+)$/); return match?.[1]; }
function authorised(request: Request) { return verifyDeviceAgentToken(agentToken(request)); }

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId(); if (!profileId) return NextResponse.json({ error: 'Device agent requires ELP single-user owner mode.' }, { status: 503 });
  const url = new URL(request.url); const deviceId = (url.searchParams.get('deviceId') || '').trim().slice(0, 120); if (!deviceId) return NextResponse.json({ error: 'deviceId is required.' }, { status: 400 });
  return NextResponse.json({ commands: await claimPendingCommands(profileId, deviceId) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId(); if (!profileId) return NextResponse.json({ error: 'Device agent requires ELP single-user owner mode.' }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null; const commandId = typeof body?.commandId === 'string' ? body.commandId : ''; const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''; if (!commandId || !deviceId) return NextResponse.json({ error: 'commandId and deviceId are required.' }, { status: 400 });
  try { await completeDeviceCommand(profileId, commandId, deviceId, body?.ok === true, typeof body?.result === 'string' ? body.result : undefined); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Device acknowledgement failed.' }, { status: 400 }); }
}
