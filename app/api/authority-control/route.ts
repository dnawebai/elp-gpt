import { NextResponse } from 'next/server';
import { hasCapability, isPrincipalRole } from '@/lib/authority-policy';
import {
  authoritySnapshot,
  createCompanionEnrollment,
  createPrincipal,
  resolveAuthorityContext,
  revokeCompanionDevice,
  revokePrincipal,
} from '@/lib/principal-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function manager(request: Request) {
  const context = await resolveAuthorityContext(request);
  if (!context) return null;
  return hasCapability(context.principal.role, 'manage_authority', context.principal.capabilities) ? context : null;
}

export async function GET(request: Request) {
  const context = await manager(request);
  if (!context) return NextResponse.json({ error: 'Authority management permission is required.' }, { status: 403 });
  return NextResponse.json(await authoritySnapshot(context.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await manager(request);
  if (!context) return NextResponse.json({ error: 'Authority management permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'create-principal') {
      const role = body?.role;
      if (!isPrincipalRole(role)) return NextResponse.json({ error: 'Invalid principal role.' }, { status: 400 });
      const principal = await createPrincipal({
        profileId: context.profileId,
        actorPrincipalId: context.principal.id,
        displayName: typeof body?.displayName === 'string' ? body.displayName : '',
        role,
        capabilities: Array.isArray(body?.capabilities) ? body.capabilities.filter((x): x is string => typeof x === 'string') : undefined,
      });
      return NextResponse.json({ ok: true, principal, snapshot: await authoritySnapshot(context.profileId) }, { status: 201 });
    }
    if (action === 'revoke-principal') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      await revokePrincipal(context.profileId, context.principal.id, principalId);
      return NextResponse.json({ ok: true, snapshot: await authoritySnapshot(context.profileId) });
    }
    if (action === 'create-enrollment') {
      const principalId = typeof body?.principalId === 'string' ? body.principalId : '';
      if (!principalId) return NextResponse.json({ error: 'principalId is required.' }, { status: 400 });
      const enrollment = await createCompanionEnrollment({
        profileId: context.profileId,
        actorPrincipalId: context.principal.id,
        principalId,
        label: typeof body?.label === 'string' ? body.label : '',
        allowedCommands: Array.isArray(body?.allowedCommands) ? body.allowedCommands.filter((x): x is string => typeof x === 'string') : undefined,
      });
      return NextResponse.json({ ok: true, enrollment }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'revoke-device') {
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
      if (!deviceId) return NextResponse.json({ error: 'deviceId is required.' }, { status: 400 });
      await revokeCompanionDevice(context.profileId, context.principal.id, deviceId);
      return NextResponse.json({ ok: true, snapshot: await authoritySnapshot(context.profileId) });
    }
    return NextResponse.json({ error: 'Unsupported authority action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Authority action failed.' }, { status: 400 });
  }
}
