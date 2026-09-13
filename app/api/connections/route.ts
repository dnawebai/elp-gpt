import { NextResponse } from 'next/server';
import { CONNECTION_POLICIES, createConnectionLink, isConnectionsConfigured, listConnectedAccounts, setConnectedAccountEnabled } from '@/lib/connections';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const accounts = await listConnectedAccounts(profile.profileId);
    return NextResponse.json({
      configured: isConnectionsConfigured(),
      accounts,
      policies: CONNECTION_POLICIES,
      profileId: profile.profileId,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account read failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Connected account read failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { toolkit?: unknown } | null;
    const toolkit = typeof body?.toolkit === 'string' ? body.toolkit.trim().toLowerCase() : '';
    if (!toolkit) return NextResponse.json({ error: 'toolkit is required.' }, { status: 400 });
    if (!/^[a-z0-9_-]{2,80}$/.test(toolkit)) return NextResponse.json({ error: 'Invalid toolkit.' }, { status: 400 });

    const origin = new URL(request.url).origin;
    const callbackUrl = `${origin}/connections?connected=${encodeURIComponent(toolkit)}`;
    const link = await createConnectionLink({ profileId: profile.profileId, toolkit, callbackUrl });
    return NextResponse.json(link, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account link creation failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create connection link.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { id?: unknown; enabled?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be boolean.' }, { status: 400 });
    const result = await setConnectedAccountEnabled(profile.profileId, id, body.enabled);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account status update failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update connected account.' }, { status: 500 });
  }
}
