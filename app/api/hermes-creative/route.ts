import { NextRequest, NextResponse } from 'next/server';
import { runSeniorHermesCreativeMission } from '@/lib/hermes-senior-executor';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

function clean(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : undefined;
}

export async function POST(request: NextRequest) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      objective?: unknown;
      brand?: unknown;
      website?: unknown;
      audience?: unknown;
      offer?: unknown;
      channels?: unknown;
      competitors?: unknown;
      assetCount?: unknown;
      context?: unknown;
    };
    const objective = clean(body.objective, 2200);
    if (!objective) return NextResponse.json({ error: 'objective is required' }, { status: 400 });
    const result = await runSeniorHermesCreativeMission(profile.profileId, {
      objective,
      brand: clean(body.brand),
      website: clean(body.website),
      audience: clean(body.audience),
      offer: clean(body.offer),
      channels: clean(body.channels),
      competitors: clean(body.competitors),
      assetCount: typeof body.assetCount === 'number' ? body.assetCount : Number(body.assetCount) || undefined,
      context: clean(body.context, 2200),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Senior Hermes creative execution failed.';
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
