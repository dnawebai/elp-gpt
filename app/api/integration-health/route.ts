import { NextResponse } from 'next/server';
import { getLatestIntegrationHealth, repairIntegrationIssue, runIntegrationHealth } from '@/lib/integration-health';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const latest = await getLatestIntegrationHealth(profile.profileId);
  const snapshot = latest || await runIntegrationHealth({ profileId: profile.profileId, persist: true, refreshProviders: false });
  return NextResponse.json({ snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  try {
    const profile = readProfile(request);
    if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { action?: unknown; issueId?: unknown } | null;
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'scan') {
      const snapshot = await runIntegrationHealth({ profileId: profile.profileId, persist: true, refreshProviders: true });
      return NextResponse.json({ snapshot }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (action === 'repair') {
      const issueId = typeof body?.issueId === 'string' ? body.issueId.trim() : '';
      if (!issueId) return NextResponse.json({ error: 'issueId is required.' }, { status: 400 });
      const result = await repairIntegrationIssue({ profileId: profile.profileId, issueId, origin: new URL(request.url).origin });
      return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    console.error('Integration health action failed', error);
    const message = error instanceof Error ? error.message : 'Integration health action failed.';
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
  }
}
