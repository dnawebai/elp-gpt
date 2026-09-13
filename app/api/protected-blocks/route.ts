import { NextResponse } from 'next/server';
import { createProtectedBlock, listProtectedBlocks, updateProtectedBlock } from '@/lib/protected-blocks';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json({ blocks: await listProtectedBlocks(profile.profileId, { includeInactive: url.searchParams.get('all') === '1', from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined }) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const block = await createProtectedBlock(profile.profileId, { label: typeof body?.label === 'string' ? body.label : '', start: typeof body?.start === 'string' ? body.start : '', end: typeof body?.end === 'string' ? body.end : '', immovable: body?.immovable !== false, reason: typeof body?.reason === 'string' ? body.reason : undefined });
    return NextResponse.json({ ok: true, block }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to protect block.' }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null; const id = typeof body?.id === 'string' ? body.id : ''; if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  try { const block = await updateProtectedBlock(profile.profileId, id, { ...(typeof body?.label === 'string' ? { label: body.label } : {}), ...(typeof body?.start === 'string' ? { start: body.start } : {}), ...(typeof body?.end === 'string' ? { end: body.end } : {}), ...(typeof body?.immovable === 'boolean' ? { immovable: body.immovable } : {}), ...(typeof body?.active === 'boolean' ? { active: body.active } : {}), ...(typeof body?.reason === 'string' ? { reason: body.reason } : {}) }); return NextResponse.json({ ok: true, block }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update protected block.' }, { status: 400 }); }
}
