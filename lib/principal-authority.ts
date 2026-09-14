import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { capabilitiesForRole, effectiveCapabilities, hasCapability, isPrincipalRole, type AuthorityCapability, type PrincipalRole } from '@/lib/authority-policy';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import {
  AUTHORITY_COOKIE,
  PROFILE_COOKIE,
  createCompanionEnrollmentToken,
  createCompanionToken,
  createPrincipalAccessToken,
  verifyCompanionEnrollmentToken,
  verifyCompanionToken,
  verifyPrincipalSessionToken,
  verifyProfileToken,
} from '@/lib/security';
import type { DeviceCommandType } from '@/lib/device-control';

export type PrincipalStatus = 'active' | 'revoked';
export type Principal = {
  id: string;
  displayName: string;
  role: PrincipalRole;
  capabilities: AuthorityCapability[];
  status: PrincipalStatus;
  createdAt: string;
  updatedAt: string;
  createdByPrincipalId?: string;
};

export type CompanionDeviceStatus = 'active' | 'revoked';
export type CompanionDevice = {
  id: string;
  label: string;
  platform: string;
  agentVersion?: string;
  principalId: string;
  allowedCommands: DeviceCommandType[];
  status: CompanionDeviceStatus;
  tokenVersion: string;
  enrolledAt: string;
  updatedAt: string;
  lastSeenAt?: string;
};

export type AuthorityAudit = {
  id: string;
  actorPrincipalId: string;
  action: string;
  target?: string;
  detail?: string;
  createdAt: string;
};

export type AuthorityContext = {
  profileId: string;
  principal: Principal;
};

const DEVICE_COMMANDS = new Set<DeviceCommandType>(['focus_on','focus_off','open_url','open_app','lock_screen']);
function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function sessionFor(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`authority-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function parsePrincipal(message: { metadata: Record<string, unknown> }): Principal | null {
  if (message.metadata?.elpPrincipal !== true) return null;
  const item = parseJson<Principal>(message.metadata.principalJson);
  if (!item || !item.id || !isPrincipalRole(item.role) || !['active','revoked'].includes(item.status)) return null;
  item.capabilities = effectiveCapabilities(item.role, item.capabilities);
  return item;
}

function parseDevice(message: { metadata: Record<string, unknown> }): CompanionDevice | null {
  if (message.metadata?.elpCompanionDevice !== true) return null;
  const item = parseJson<CompanionDevice>(message.metadata.deviceJson);
  if (!item || !item.id || !item.principalId || !['active','revoked'].includes(item.status)) return null;
  item.allowedCommands = (item.allowedCommands || []).filter((value): value is DeviceCommandType => DEVICE_COMMANDS.has(value));
  return item;
}

function parseAudit(message: { metadata: Record<string, unknown> }): AuthorityAudit | null {
  if (message.metadata?.elpAuthorityAudit !== true) return null;
  return parseJson<AuthorityAudit>(message.metadata.auditJson);
}

function cookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function appendAudit(profileId: string, audit: Omit<AuthorityAudit, 'id' | 'createdAt'>) {
  const handles = await sessionFor(profileId);
  if (!handles) return;
  const item: AuthorityAudit = { id: randomUUID(), createdAt: new Date().toISOString(), ...audit };
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[AUTHORITY_AUDIT] ${item.action}${item.target ? ` ${item.target}` : ''}`, metadata: { elpAuthorityAudit: true, recordVersion: 1, auditJson: JSON.stringify(item) } }]);
}

export async function listPrincipals(profileId: string) {
  const handles = await sessionFor(profileId);
  if (!handles) return [] as Principal[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const map = new Map<string, Principal>();
  for (const message of messages) {
    const item = parsePrincipal(message);
    if (item && !map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}

export async function ensureOwnerPrincipal(profileId: string) {
  const principals = await listPrincipals(profileId);
  const existing = principals.find((item) => item.role === 'owner' && item.status === 'active');
  if (existing) return existing;
  const handles = await sessionFor(profileId);
  if (!handles) throw new Error('Authority storage is unavailable.');
  const now = new Date().toISOString();
  const principal: Principal = { id: 'principal-owner', displayName: 'Owner', role: 'owner', capabilities: capabilitiesForRole('owner'), status: 'active', createdAt: now, updatedAt: now };
  await handles.session.addMessages([{ peerId: handles.user.id, content: '[PRINCIPAL] Owner', metadata: { elpPrincipal: true, recordVersion: 1, principalJson: JSON.stringify(principal) } }]);
  await appendAudit(profileId, { actorPrincipalId: principal.id, action: 'authority.bootstrap', target: principal.id });
  return principal;
}

export async function getPrincipal(profileId: string, principalId: string) {
  const principals = await listPrincipals(profileId);
  return principals.find((item) => item.id === principalId) || null;
}

export async function createPrincipal(args: { profileId: string; actorPrincipalId: string; displayName: string; role: PrincipalRole; capabilities?: string[] }) {
  if (args.role === 'owner') throw new Error('The bootstrap owner role cannot be delegated.');
  const actor = await getPrincipal(args.profileId, args.actorPrincipalId);
  if (!actor || actor.status !== 'active' || !hasCapability(actor.role, 'manage_authority', actor.capabilities)) throw new Error('Principal is not authorized to manage authority.');
  const handles = await sessionFor(args.profileId); if (!handles) throw new Error('Authority storage is unavailable.');
  const now = new Date().toISOString();
  const displayName = args.displayName.trim().slice(0, 120); if (!displayName) throw new Error('Display name is required.');
  const principal: Principal = { id: randomUUID(), displayName, role: args.role, capabilities: effectiveCapabilities(args.role, args.capabilities), status: 'active', createdAt: now, updatedAt: now, createdByPrincipalId: actor.id };
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[PRINCIPAL] ${displayName}`, metadata: { elpPrincipal: true, recordVersion: 1, principalJson: JSON.stringify(principal) } }]);
  await appendAudit(args.profileId, { actorPrincipalId: actor.id, action: 'principal.create', target: principal.id, detail: `${principal.role}: ${principal.capabilities.join(',')}` });
  return principal;
}

async function writePrincipal(profileId: string, principal: Principal, actorPrincipalId: string, action: string) {
  const handles = await sessionFor(profileId); if (!handles) throw new Error('Authority storage is unavailable.');
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[PRINCIPAL] ${principal.displayName}: ${principal.status}`, metadata: { elpPrincipal: true, recordVersion: 1, principalJson: JSON.stringify(principal) } }]);
  await appendAudit(profileId, { actorPrincipalId, action, target: principal.id });
  return principal;
}

export async function revokePrincipal(profileId: string, actorPrincipalId: string, principalId: string) {
  const actor = await getPrincipal(profileId, actorPrincipalId);
  if (!actor || !hasCapability(actor.role, 'manage_authority', actor.capabilities)) throw new Error('Principal is not authorized to manage authority.');
  const principal = await getPrincipal(profileId, principalId); if (!principal) throw new Error('Principal not found.');
  if (principal.role === 'owner') throw new Error('The bootstrap owner cannot be revoked.');
  return writePrincipal(profileId, { ...principal, status: 'revoked', updatedAt: new Date().toISOString() }, actor.id, 'principal.revoke');
}

export async function createPrincipalAccess(profileId: string, actorPrincipalId: string, principalId: string) {
  const actor = await getPrincipal(profileId, actorPrincipalId);
  if (!actor || !hasCapability(actor.role, 'manage_authority', actor.capabilities)) throw new Error('Principal is not authorized to manage authority.');
  const principal = await getPrincipal(profileId, principalId); if (!principal || principal.status !== 'active') throw new Error('Principal is not active.');
  const token = createPrincipalAccessToken(profileId, principal.id);
  await appendAudit(profileId, { actorPrincipalId: actor.id, action: 'principal.access_issued', target: principal.id });
  return { token, expiresInSeconds: 86_400 };
}

export async function resolveAuthorityContext(request: Request): Promise<AuthorityContext | null> {
  const profile = verifyProfileToken(cookie(request, PROFILE_COOKIE));
  if (!profile) return null;
  const session = verifyPrincipalSessionToken(cookie(request, AUTHORITY_COOKIE));
  if (session && session.profileId === profile.profileId) {
    const principal = await getPrincipal(profile.profileId, session.principalId);
    if (principal?.status === 'active') return { profileId: profile.profileId, principal };
    return null;
  }
  const owner = await ensureOwnerPrincipal(profile.profileId);
  return { profileId: profile.profileId, principal: owner };
}

function sanitizeCommands(principal: Principal, requested?: string[]) {
  if (!hasCapability(principal.role, 'control_devices', principal.capabilities)) return [] as DeviceCommandType[];
  const source = requested?.length ? requested : [...DEVICE_COMMANDS];
  return source.filter((item): item is DeviceCommandType => DEVICE_COMMANDS.has(item as DeviceCommandType));
}

export async function createCompanionEnrollment(args: { profileId: string; actorPrincipalId: string; principalId: string; label: string; allowedCommands?: string[] }) {
  const actor = await getPrincipal(args.profileId, args.actorPrincipalId);
  if (!actor || !hasCapability(actor.role, 'manage_authority', actor.capabilities)) throw new Error('Principal is not authorized to enroll devices.');
  const principal = await getPrincipal(args.profileId, args.principalId); if (!principal || principal.status !== 'active') throw new Error('Target principal is not active.');
  const handles = await sessionFor(args.profileId); if (!handles) throw new Error('Authority storage is unavailable.');
  const id = randomUUID(); const nonce = randomUUID(); const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const enrollment = { id, principalId: principal.id, label: args.label.trim().slice(0,120) || `${principal.displayName} device`, allowedCommands: sanitizeCommands(principal, args.allowedCommands), nonce, expiresAt, createdAt: new Date().toISOString(), consumedAt: '' };
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[COMPANION_ENROLLMENT] ${enrollment.label}`, metadata: { elpCompanionEnrollment: true, recordVersion: 1, enrollmentJson: JSON.stringify(enrollment) } }]);
  const token = createCompanionEnrollmentToken({ profileId: args.profileId, principalId: principal.id, enrollmentId: id, nonce, ttlSeconds: 1800 });
  await appendAudit(args.profileId, { actorPrincipalId: actor.id, action: 'companion.enrollment_issued', target: id, detail: enrollment.label });
  return { enrollmentToken: token, enrollmentId: id, expiresAt, allowedCommands: enrollment.allowedCommands };
}

export async function listCompanionDevices(profileId: string) {
  const handles = await sessionFor(profileId); if (!handles) return [] as CompanionDevice[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const map = new Map<string, CompanionDevice>();
  for (const message of messages) { const item = parseDevice(message); if (item && !map.has(item.id)) map.set(item.id, item); }
  return [...map.values()].sort((a,b) => (b.lastSeenAt || b.enrolledAt).localeCompare(a.lastSeenAt || a.enrolledAt));
}

async function writeDevice(profileId: string, device: CompanionDevice) {
  const handles = await sessionFor(profileId); if (!handles) throw new Error('Authority storage is unavailable.');
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[COMPANION_DEVICE] ${device.label}: ${device.status}`, metadata: { elpCompanionDevice: true, recordVersion: 1, deviceJson: JSON.stringify(device) } }]);
  return device;
}

export async function consumeCompanionEnrollment(args: { token: string; deviceId: string; label?: string; platform?: string; agentVersion?: string }) {
  const claims = verifyCompanionEnrollmentToken(args.token); if (!claims) throw new Error('Invalid or expired companion enrollment token.');
  const handles = await sessionFor(claims.profileId); if (!handles) throw new Error('Authority storage is unavailable.');
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const entry = messages.find((message) => message.metadata?.elpCompanionEnrollment === true && parseJson<{ id: string }>(message.metadata.enrollmentJson)?.id === claims.enrollmentId);
  if (!entry) throw new Error('Companion enrollment was not found.');
  const enrollment = parseJson<{ id: string; principalId: string; label: string; allowedCommands: DeviceCommandType[]; nonce: string; expiresAt: string; createdAt: string; consumedAt?: string }>(entry.metadata.enrollmentJson);
  if (!enrollment || enrollment.nonce !== claims.nonce || enrollment.principalId !== claims.principalId || enrollment.consumedAt) throw new Error('Companion enrollment is no longer valid.');
  if (Date.parse(enrollment.expiresAt) <= Date.now()) throw new Error('Companion enrollment expired.');
  const principal = await getPrincipal(claims.profileId, claims.principalId); if (!principal || principal.status !== 'active') throw new Error('Principal is not active.');
  const id = args.deviceId.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0,96); if (!id) throw new Error('deviceId is required.');
  const now = new Date().toISOString(); const tokenVersion = randomUUID();
  const device: CompanionDevice = { id, label: (args.label || enrollment.label || id).trim().slice(0,120), platform: (args.platform || 'unknown').trim().slice(0,80), agentVersion: args.agentVersion?.trim().slice(0,80), principalId: principal.id, allowedCommands: sanitizeCommands(principal, enrollment.allowedCommands), status: 'active', tokenVersion, enrolledAt: now, updatedAt: now, lastSeenAt: now };
  await writeDevice(claims.profileId, device);
  await handles.session.updateMessage(entry.id, { ...entry.metadata, enrollmentJson: JSON.stringify({ ...enrollment, consumedAt: now }) });
  await appendAudit(claims.profileId, { actorPrincipalId: principal.id, action: 'companion.enroll', target: device.id, detail: device.platform });
  return { profileId: claims.profileId, principal, device, companionToken: createCompanionToken({ profileId: claims.profileId, principalId: principal.id, deviceId: device.id, tokenVersion }) };
}

export async function verifyCompanionAccess(token: string | undefined) {
  const claims = verifyCompanionToken(token); if (!claims) return null;
  const principal = await getPrincipal(claims.profileId, claims.principalId); if (!principal || principal.status !== 'active') return null;
  const devices = await listCompanionDevices(claims.profileId); const device = devices.find((item) => item.id === claims.deviceId);
  if (!device || device.status !== 'active' || device.principalId !== principal.id || device.tokenVersion !== claims.tokenVersion) return null;
  return { profileId: claims.profileId, principal, device };
}

export async function heartbeatCompanion(profileId: string, deviceId: string) {
  const devices = await listCompanionDevices(profileId); const device = devices.find((item) => item.id === deviceId); if (!device || device.status !== 'active') return null;
  const updated = { ...device, lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await writeDevice(profileId, updated); return updated;
}

export async function revokeCompanionDevice(profileId: string, actorPrincipalId: string, deviceId: string) {
  const actor = await getPrincipal(profileId, actorPrincipalId); if (!actor || !hasCapability(actor.role, 'manage_authority', actor.capabilities)) throw new Error('Principal is not authorized to manage devices.');
  const devices = await listCompanionDevices(profileId); const device = devices.find((item) => item.id === deviceId); if (!device) throw new Error('Device not found.');
  const updated: CompanionDevice = { ...device, status: 'revoked', tokenVersion: randomUUID(), updatedAt: new Date().toISOString() };
  await writeDevice(profileId, updated); await appendAudit(profileId, { actorPrincipalId: actor.id, action: 'companion.revoke', target: device.id }); return updated;
}

export async function listAuthorityAudit(profileId: string, limit = 100) {
  const handles = await sessionFor(profileId); if (!handles) return [] as AuthorityAudit[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  return messages.map(parseAudit).filter((item): item is AuthorityAudit => Boolean(item)).slice(0, Math.max(1, Math.min(500, limit)));
}

export async function authoritySnapshot(profileId: string) {
  await ensureOwnerPrincipal(profileId);
  const [principals, devices, audit] = await Promise.all([listPrincipals(profileId), listCompanionDevices(profileId), listAuthorityAudit(profileId, 50)]);
  const now = Date.now();
  return {
    principals,
    devices: devices.map((device) => ({ ...device, online: device.status === 'active' && Boolean(device.lastSeenAt) && now - Date.parse(device.lastSeenAt || '') <= 2 * 60_000 })),
    audit,
    stats: { activePrincipals: principals.filter((item) => item.status === 'active').length, activeDevices: devices.filter((item) => item.status === 'active').length, onlineDevices: devices.filter((item) => item.status === 'active' && item.lastSeenAt && now - Date.parse(item.lastSeenAt) <= 2 * 60_000).length },
  };
}
