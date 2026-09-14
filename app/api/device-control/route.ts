import { NextResponse } from 'next/server';
import { deviceAgentConfigured, enqueueDeviceCommand, listDeviceCommands, type DeviceCommandType } from '@/lib/device-control';
import { listCompanionDevices } from '@/lib/principal-authority';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) return NextResponse.json({ error: 'Authorized principal session is required.' }, { status: 401 });
  const devices = await listCompanionDevices(context.profileId);
  const activeDevices = devices.filter((item) => item.status === 'active');
  return NextResponse.json({
    agentConfigured: deviceAgentConfigured() || activeDevices.length > 0,
    legacyAgentConfigured: deviceAgentConfigured(),
    devices: activeDevices,
    commands: await listDeviceCommands(context.profileId, 50),
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'control_devices');
  if (!context) return NextResponse.json({ error: 'Active principal session with device-control permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const type = typeof body?.type === 'string' ? body.type as DeviceCommandType : 'focus_on';
  const devices = (await listCompanionDevices(context.profileId)).filter((item) => item.status === 'active');
  let targetDeviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim().slice(0,96) : '';
  if (!targetDeviceId && !deviceAgentConfigured() && devices.length === 1) targetDeviceId = devices[0].id;
  if (targetDeviceId && !devices.some((item) => item.id === targetDeviceId)) return NextResponse.json({ error: 'Target companion is not active.' }, { status: 400 });
  try {
    const command = await enqueueDeviceCommand(
      context.profileId,
      type,
      typeof body?.target === 'string' ? body.target : undefined,
      { targetDeviceId: targetDeviceId || undefined, requestedByPrincipalId: context.principal.id, allowWithoutLegacyAgent: Boolean(targetDeviceId) },
    );
    return NextResponse.json({ ok: true, command, requestedByPrincipalId: context.principal.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Device command failed.' }, { status: 503 });
  }
}
