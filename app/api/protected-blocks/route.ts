import { NextResponse } from 'next/server';
import { createProtectedBlock, listProtectedBlocks, updateProtectedBlock } from '@/lib/protected-blocks';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) return NextResponse.json({ error: 'Authorized principal session is required.' }, { status: 401 });
  const url = new URL(request.url);
  return NextResponse.json({ blocks: await listProtectedBlocks(context.profileId, { includeInactive: url.searchParams.get('all') === '1', from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined }) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'manage_calendar');
  if (!context) return NextResponse.json({ error: 'Calendar-management permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const block = await createProtectedBlock(context.profileId, { label: typeof body?.label === 'string' ? body.label : '', start: typeof body?.start === 'string' ? body.start : '', end: typeof body?.end === 'string' ? body.end : '', immovable: body?.immovable !== false, reason: typeof body?.reason === 'string' ? body.reason : undefined });
    return NextResponse.json({ ok: true, block, principalId: context.principal.id }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to protect block.' }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'manage_calendar');
  if (!context) return NextResponse.json({ error: 'Calendar-management permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null; const id = typeof body?.id === 'string' ? body.id : ''; if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  try { const block = await updateProtectedBlock(context.profileId, id, { ...(typeof body?.label === 'string' ? { label: body.label } : {}), ...(typeof body?.start === 'string' ? { start: body.start } : {}), ...(typeof body?.end === 'string' ? { end: body.end } : {}), ...(typeof body?.immovable === 'boolean' ? { immovable: body.immovable } : {}), ...(typeof body?.active === 'boolean' ? { active: body.active } : {}), ...(typeof body?.reason === 'string' ? { reason: body.reason } : {}) }); return NextResponse.json({ ok: true, block, principalId: context.principal.id }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update protected block.' }, { status: 400 }); }
}
