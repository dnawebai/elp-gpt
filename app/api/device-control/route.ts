import { NextResponse } from 'next/server';
import { deviceAgentConfigured, enqueueDeviceCommand, listDeviceCommands, type DeviceCommandType } from '@/lib/device-control';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request: Request) { const token = (request.headers.get('cookie') || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1); return verifyProfileToken(token); }

export async function GET(request: Request) { const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 }); return NextResponse.json({ agentConfigured: deviceAgentConfigured(), commands: await listDeviceCommands(profile.profileId, 50) }, { headers: { 'Cache-Control': 'no-store, private' } }); }
export async function POST(request: Request) { const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 }); const body = await request.json().catch(() => null) as Record<string, unknown> | null; const type = typeof body?.type === 'string' ? body.type as DeviceCommandType : 'focus_on'; try { const command = await enqueueDeviceCommand(profile.profileId, type, typeof body?.target === 'string' ? body.target : undefined); return NextResponse.json({ ok: true, command }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Device command failed.' }, { status: 503 }); } }
