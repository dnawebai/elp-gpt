import { NextResponse } from 'next/server';
import { CONNECTION_POLICIES, createConnectionLink, isConnectionsConfigured, listConnectedAccounts, setConnectedAccountEnabled } from '@/lib/connections';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

function providerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('(401)') || message.includes('APIKey_InvalidAPIKey')) return 'Connected account provider authentication failed.';
  return 'Connected account provider is temporarily unavailable.';
}

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) return NextResponse.json({ error: 'Authorized principal session is required.' }, { status: 401 });
  const configured = isConnectionsConfigured();
  if (!configured) return NextResponse.json({ configured: false, providerReady: false, providerError: 'Connected account provider is not configured on this deployment.', accounts: [], policies: CONNECTION_POLICIES, profileId: context.profileId }, { headers: { 'Cache-Control': 'no-store, private' } });
  try {
    const accounts = await listConnectedAccounts(context.profileId);
    return NextResponse.json({ configured: true, providerReady: true, providerError: null, accounts, policies: CONNECTION_POLICIES, profileId: context.profileId }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account provider read failed', error);
    return NextResponse.json({ configured: true, providerReady: false, providerError: providerErrorMessage(error), accounts: [], policies: CONNECTION_POLICIES, profileId: context.profileId }, { headers: { 'Cache-Control': 'no-store, private' } });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireZeroTrustAuthority(request, 'manage_integrations');
    if (!context) return NextResponse.json({ error: 'Integration-management permission is required.' }, { status: 403 });
    const body = (await request.json().catch(() => null)) as { toolkit?: unknown } | null;
    const toolkit = typeof body?.toolkit === 'string' ? body.toolkit.trim().toLowerCase() : '';
    if (!toolkit || !/^[a-z0-9_-]{2,80}$/.test(toolkit)) return NextResponse.json({ error: 'Valid toolkit is required.' }, { status: 400 });
    const origin = new URL(request.url).origin;
    const callbackUrl = `${origin}/connections?connected=${encodeURIComponent(toolkit)}`;
    const link = await createConnectionLink({ profileId: context.profileId, toolkit, callbackUrl });
    return NextResponse.json(link, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account link creation failed', error);
    return NextResponse.json({ error: providerErrorMessage(error) }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireZeroTrustAuthority(request, 'manage_integrations');
    if (!context) return NextResponse.json({ error: 'Integration-management permission is required.' }, { status: 403 });
    const body = (await request.json().catch(() => null)) as { id?: unknown; enabled?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id || typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'id and enabled are required.' }, { status: 400 });
    const result = await setConnectedAccountEnabled(context.profileId, id, body.enabled);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Connected account status update failed', error);
    return NextResponse.json({ error: providerErrorMessage(error) }, { status: 503 });
  }
}
