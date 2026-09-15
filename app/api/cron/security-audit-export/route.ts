import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { exportSecurityAudit } from '@/lib/security-audit-export';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Security audit export requires ELP single-user mode.' }, { status: 503 });
  const state = await exportSecurityAudit(profileId);
  return NextResponse.json({
    ok: !state.lastError,
    configured: state.configured,
    exportedEvents: state.exportedEvents,
    lastExportedAt: state.lastExportedAt,
    lastHeadHash: state.lastHeadHash,
    error: state.lastError,
  }, { status: state.lastError && state.configured ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
