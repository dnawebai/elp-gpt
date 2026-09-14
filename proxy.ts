import { NextRequest, NextResponse } from 'next/server';
import { hasCapability } from '@/lib/authority-policy';
import { isPublicApiRoute, requiredApiCapability } from '@/lib/api-authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { ensureOwnerPrincipal, getPrincipal } from '@/lib/principal-authority';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import { AUTHORITY_COOKIE, PROFILE_COOKIE, verifyPrincipalSessionToken, verifyProfileToken } from '@/lib/security';

function denied(message: string, status: number, extra?: Record<string, unknown>) { return NextResponse.json({ error: message, ...(extra || {}) }, { status, headers: { 'Cache-Control':'no-store, private' } }); }
function ownerBootstrapPath(pathname: string) { return pathname === '/api/passkeys' || pathname === '/api/authority-session' || pathname === '/api/identity'; }

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/api/') || isPublicApiRoute(pathname) || request.method === 'OPTIONS') return NextResponse.next();
  const profile = verifyProfileToken(request.cookies.get(PROFILE_COOKIE)?.value); if (!profile) return denied('ELP identity is required.',401);
  const authorityToken = request.cookies.get(AUTHORITY_COOKIE)?.value;
  if (!authorityToken) {
    const owner = await ensureOwnerPrincipal(profile.profileId);
    const passkeys = await listActivePasskeys(profile.profileId, owner.id);
    if (passkeys.length > 0 && !ownerBootstrapPath(pathname)) return denied('Authenticated owner session is required. Verify your passkey to continue.',428,{ ownerSessionRequired:true, stepUpRequired:true, stepUpMethod:'passkey' });
    const headers = new Headers(request.headers); headers.set('x-elp-authority-mode','owner-bootstrap'); headers.set('x-elp-profile-id',profile.profileId); headers.set('x-elp-principal-id',owner.id); headers.set('x-elp-principal-role','owner');
    return NextResponse.next({ request:{headers} });
  }
  const claims = verifyPrincipalSessionToken(authorityToken); if (!claims || claims.profileId !== profile.profileId) return denied('Authority session is invalid or expired.',401);
  const [principal,liveSession] = await Promise.all([getPrincipal(profile.profileId,claims.principalId),validatePrincipalSession({profileId:profile.profileId,principalId:claims.principalId,sessionId:claims.sessionId,tokenVersion:claims.tokenVersion})]);
  if (!principal || principal.status !== 'active' || !liveSession) return denied('Authority session has been revoked.',401);
  const required = requiredApiCapability(pathname,request.method); if (!hasCapability(principal.role,required,principal.capabilities)) return denied(`Principal does not have ${required} permission for this API operation.`,403);
  const headers = new Headers(request.headers); headers.set('x-elp-authority-mode',principal.role==='owner'?'owner-session':'delegated'); headers.set('x-elp-profile-id',profile.profileId); headers.set('x-elp-principal-id',principal.id); headers.set('x-elp-principal-role',principal.role);
  return NextResponse.next({request:{headers}});
}
export const config={matcher:['/api/:path*']};
