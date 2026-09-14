import { hasCapability, type AuthorityCapability } from '@/lib/authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { ensureOwnerPrincipal, getPrincipal, type Principal } from '@/lib/principal-authority';
import { validatePrincipalSession, touchPrincipalSession, type PrincipalSessionRecord } from '@/lib/principal-sessions';
import { AUTHORITY_COOKIE, PROFILE_COOKIE, verifyPrincipalSessionToken, verifyProfileToken } from '@/lib/security';

export type ZeroTrustAuthorityContext = { profileId: string; principal: Principal; delegated: boolean; session: PrincipalSessionRecord | null };
function cookie(request: Request, name: string) { return (request.headers.get('cookie') || '').split(';').map((part)=>part.trim()).find((part)=>part.startsWith(`${name}=`))?.slice(name.length+1); }
function ownerBootstrapRoute(request: Request) { const path = new URL(request.url).pathname; return path === '/api/passkeys' || path === '/api/authority-session' || path === '/api/identity'; }

export async function resolveZeroTrustAuthority(request: Request): Promise<ZeroTrustAuthorityContext | null> {
  const profile = verifyProfileToken(cookie(request, PROFILE_COOKIE)); if (!profile) return null;
  const authorityToken = cookie(request, AUTHORITY_COOKIE);
  if (!authorityToken) {
    const owner = await ensureOwnerPrincipal(profile.profileId);
    const passkeys = await listActivePasskeys(profile.profileId, owner.id);
    if (passkeys.length > 0 && !ownerBootstrapRoute(request)) return null;
    return { profileId: profile.profileId, principal: owner, delegated: false, session: null };
  }
  const claims = verifyPrincipalSessionToken(authorityToken); if (!claims || claims.profileId !== profile.profileId) return null;
  const [principal, session] = await Promise.all([getPrincipal(profile.profileId, claims.principalId), validatePrincipalSession({ profileId: profile.profileId, principalId: claims.principalId, sessionId: claims.sessionId, tokenVersion: claims.tokenVersion })]);
  if (!principal || principal.status !== 'active' || !session) return null;
  void touchPrincipalSession(profile.profileId, session.id).catch(()=>undefined);
  return { profileId: profile.profileId, principal, delegated: principal.role !== 'owner', session };
}

export async function requireZeroTrustAuthority(request: Request, capability?: AuthorityCapability) {
  const context = await resolveZeroTrustAuthority(request); if (!context) return null;
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) return null;
  return context;
}
export function requiresDelegatedStepUp(context: ZeroTrustAuthorityContext, risk: 'read'|'write'|'high') { return context.delegated && risk === 'high'; }
