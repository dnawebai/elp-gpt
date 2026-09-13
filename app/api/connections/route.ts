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

function providerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('(401)') || message.includes('APIKey_InvalidAPIKey')) {
    return 'Composio project authentication failed. Replace COMPOSIO_API_KEY with a valid project API key.';
  }
  return 'Connected account provider is temporarily unavailable.';
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const configured = isConnectionsConfigured();
  if (!configured) {
    return NextResponse.json({
      configured: false,
      providerReady: false,
      providerError: 'Composio is not configured on this deployment.',
      accounts: [],
      policies: CONNECTION_POLICIES,
      profileId: profile.profileId,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  }

  try {
    const accounts = await listConnectedAccounts(profile.profileId);
    return NextResponse.json({
      configured: true,
      providerReady: true,
      providerError: null,
      accounts,
      policies: CONNECTION_POLICIES,
      profileId: profile.profileId,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account provider read failed', error);
    return NextResponse.json({
      configured: true,
      providerReady: false,
      providerError: providerErrorMessage(error),
      accounts: [],
      policies: CONNECTION_POLICIES,
      profileId: profile.profileId,
    }, { headers: { 'Cache-Control': 'no-store, private' } });
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
    return NextResponse.json({ error: providerErrorMessage(error) }, { status: 503 });
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
    return NextResponse.json({ error: providerErrorMessage(error) }, { status: 503 });
  }
}
