import { NextRequest, NextResponse } from 'next/server';
import { runHermesTradingMission } from '@/lib/hermes-trading';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function POST(request: NextRequest) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  try {
    const body = (await request.json()) as {
      objective?: string;
      universe?: string;
      horizon?: string;
      riskBudget?: string;
      context?: string;
    };
    if (!body.objective?.trim()) return NextResponse.json({ error: 'objective is required' }, { status: 400 });

    const result = await runHermesTradingMission(profile.profileId, {
      objective: body.objective.trim(),
      universe: body.universe?.trim(),
      horizon: body.horizon?.trim(),
      riskBudget: body.riskBudget?.trim(),
      context: body.context?.trim(),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hermes Trading Mode failed.';
    return NextResponse.json({ error: message }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
