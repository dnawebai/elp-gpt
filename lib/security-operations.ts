import { createHash, randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import { upsertNotificationCandidates, type NotificationCandidate } from '@/lib/notification-store';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { listCompanionDevices, listPrincipals, revokeCompanionDevice } from '@/lib/principal-authority';
import { listPrincipalSessions, revokeAllPrincipalSessions, revokePrincipalSession } from '@/lib/principal-sessions';
import {
  listSecurityAuditEvents,
  recentSecurityEvents,
  recordSecurityEventSafe,
  verifySecurityAuditChain,
  type SecurityAuditEvent,
  type SecurityAuditIntegrity,
  type SecurityEventSeverity,
} from '@/lib/security-audit';

export type SecurityPosture = 'normal' | 'elevated' | 'critical';
export type SecurityIncidentStatus = 'open' | 'monitoring' | 'resolved';
export type SecurityIncident = {
  id: string;
  detectionKey: string;
  severity: 'high' | 'critical';
  status: SecurityIncidentStatus;
  title: string;
  summary: string;
  recommendedAction: string;
  subjectId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedByPrincipalId?: string;
};

export type SecurityFinding = {
  key: string;
  severity: 'high' | 'critical';
  title: string;
  summary: string;
  recommendedAction: string;
  subjectId?: string;
};

export type SecurityOperationsSnapshot = {
  generatedAt: string;
  configured: boolean;
  posture: SecurityPosture;
  integrity: SecurityAuditIntegrity;
  findings: SecurityFinding[];
  incidents: SecurityIncident[];
  recentEvents: SecurityAuditEvent[];
  activeSessions: Array<{
    id: string;
    principalId: string;
    assurance: string;
    createdAt: string;
    expiresAt: string;
    lastSeenAt?: string;
    clientFingerprint?: string;
  }>;
  stats: {
    principals: number;
    activeSessions: number;
    activePasskeys: number;
    activeDevices: number;
    recentDeniedEvents: number;
    openIncidents: number;
  };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function incidentSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`security-incidents-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parseIncident(message: { metadata: Record<string, unknown> }) {
  const metadata = message.metadata || {};
  if (metadata.elpSecurityIncident !== true || typeof metadata.incidentJson !== 'string') return null;
  try {
    const incident = JSON.parse(metadata.incidentJson) as SecurityIncident;
    if (!incident?.id || !incident.detectionKey || !incident.title || !['open','monitoring','resolved'].includes(incident.status) || !['high','critical'].includes(incident.severity)) return null;
    return incident;
  } catch {
    return null;
  }
}

async function writeIncident(profileId: string, incident: SecurityIncident) {
  const handles = await incidentSession(profileId);
  if (!handles) throw new Error('Security incident storage is unavailable.');
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[SECURITY_INCIDENT] ${incident.severity} ${incident.status}: ${incident.title}`,
    metadata: {
      elpSecurityIncident: true,
      recordVersion: 1,
      incidentId: incident.id,
      detectionKey: incident.detectionKey,
      severity: incident.severity,
      status: incident.status,
      incidentJson: JSON.stringify(incident),
    },
  }]);
  return incident;
}

export async function listSecurityIncidents(profileId: string, limit = 250) {
  const handles = await incidentSession(profileId);
  if (!handles) return [] as SecurityIncident[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const latest = new Map<string, SecurityIncident>();
  for (const message of messages) {
    const incident = parseIncident(message);
    if (incident && !latest.has(incident.id)) latest.set(incident.id, incident);
  }
  return [...latest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(1000, limit)));
}

async function upsertIncident(profileId: string, finding: SecurityFinding) {
  const incidents = await listSecurityIncidents(profileId, 1000);
  const existing = incidents.find((item) => item.detectionKey === finding.key && item.status !== 'resolved');
  const now = new Date().toISOString();
  if (existing) {
    const next: SecurityIncident = {
      ...existing,
      severity: finding.severity,
      title: finding.title,
      summary: finding.summary,
      recommendedAction: finding.recommendedAction,
      ...(finding.subjectId ? { subjectId: finding.subjectId } : {}),
      status: 'open',
      updatedAt: now,
    };
    if (JSON.stringify(next) !== JSON.stringify(existing)) await writeIncident(profileId, next);
    return next;
  }
  const incident: SecurityIncident = {
    id: randomUUID(),
    detectionKey: finding.key,
    severity: finding.severity,
    status: 'open',
    title: finding.title,
    summary: finding.summary,
    recommendedAction: finding.recommendedAction,
    ...(finding.subjectId ? { subjectId: finding.subjectId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await writeIncident(profileId, incident);
  await recordSecurityEventSafe(profileId, {
    category: 'incident',
    action: 'incident.opened',
    outcome: 'info',
    severity: finding.severity,
    subjectId: incident.id,
    detail: finding.title,
  });
  return incident;
}

export async function resolveSecurityIncident(profileId: string, incidentId: string, actorPrincipalId: string) {
  const incidents = await listSecurityIncidents(profileId, 1000);
  const incident = incidents.find((item) => item.id === incidentId);
  if (!incident) throw new Error('Security incident not found.');
  if (incident.status === 'resolved') return incident;
  const now = new Date().toISOString();
  const next: SecurityIncident = { ...incident, status: 'resolved', resolvedAt: now, resolvedByPrincipalId: actorPrincipalId, updatedAt: now };
  await writeIncident(profileId, next);
  await recordSecurityEventSafe(profileId, {
    category: 'incident',
    action: 'incident.resolved',
    outcome: 'success',
    severity: 'normal',
    actorPrincipalId,
    subjectId: incident.id,
    detail: incident.title,
  });
  return next;
}

function finding(key: string, severity: 'high' | 'critical', title: string, summary: string, recommendedAction: string, subjectId?: string): SecurityFinding {
  return { key, severity, title, summary, recommendedAction, ...(subjectId ? { subjectId } : {}) };
}

function eventCount(events: SecurityAuditEvent[], predicate: (event: SecurityAuditEvent) => boolean) {
  return events.reduce((count, event) => count + (predicate(event) ? 1 : 0), 0);
}

function notificationFingerprint(incident: SecurityIncident) {
  return createHash('sha256').update(`security|${incident.id}|${incident.updatedAt}`).digest('hex').slice(0, 24);
}

async function publishIncidentNotifications(profileId: string, incidents: SecurityIncident[]) {
  const candidates: NotificationCandidate[] = incidents
    .filter((item) => item.status !== 'resolved')
    .map((item) => ({
      fingerprint: notificationFingerprint(item),
      kind: 'system' as const,
      severity: item.severity,
      title: item.title,
      summary: item.summary,
      source: 'security-operations',
      sourceId: item.id,
      action: item.recommendedAction,
    }));
  if (!candidates.length) return;
  try {
    await upsertNotificationCandidates(profileId, candidates);
  } catch (error) {
    console.error('ELP security notification write failed', error);
  }
}

export async function assessSecurityOperations(profileId: string, options?: { persistIncidents?: boolean; notify?: boolean }) : Promise<SecurityOperationsSnapshot> {
  const configured = Boolean(process.env.HONCHO_API_KEY);
  const [events, sessions, principals, devices, incidents] = await Promise.all([
    listSecurityAuditEvents(profileId, 800),
    listPrincipalSessions(profileId, 1000),
    listPrincipals(profileId),
    listCompanionDevices(profileId),
    listSecurityIncidents(profileId, 500),
  ]);
  const passkeySets = await Promise.all(principals.filter((item) => item.status === 'active').map((principal) => listActivePasskeys(profileId, principal.id)));
  const integrity = verifySecurityAuditChain(events);
  const activeSessions = sessions.filter((item) => item.status === 'active' && Date.parse(item.expiresAt) > Date.now());
  const activeDevices = devices.filter((item) => item.status === 'active');
  const last15 = recentSecurityEvents(events, 15);
  const last60 = recentSecurityEvents(events, 60);
  const findings: SecurityFinding[] = [];

  if (!integrity.ok) {
    findings.push(finding(
      'audit-integrity',
      'critical',
      'Security audit integrity failure',
      integrity.reason || 'The security event chain could not be verified.',
      'Treat the audit trail as potentially incomplete, preserve current evidence, and review recent authority changes before continuing sensitive operations.',
      integrity.brokenAtEventId,
    ));
  }

  const passkeyFailures15 = eventCount(last15, (event) => event.category === 'passkey' && (event.outcome === 'denied' || event.outcome === 'failure'));
  if (passkeyFailures15 >= 5) {
    findings.push(finding(
      'passkey-failure-burst',
      passkeyFailures15 >= 10 ? 'critical' : 'high',
      'Repeated passkey verification failures',
      `${passkeyFailures15} passkey verification failures or denials were recorded during the last 15 minutes.`,
      'Review the affected principal and active sessions. Revoke delegated sessions if the attempts are not expected.',
    ));
  }

  const denied15 = eventCount(last15, (event) => event.outcome === 'denied');
  if (denied15 >= 8) {
    findings.push(finding(
      'security-denial-burst',
      denied15 >= 16 ? 'critical' : 'high',
      'Burst of denied security operations',
      `${denied15} denied security operations were recorded during the last 15 minutes.`,
      'Inspect the recent security ledger for the affected principal or session and revoke suspicious sessions.',
    ));
  }

  for (const principal of principals) {
    const principalSessions = activeSessions.filter((item) => item.principalId === principal.id);
    if (principal.status === 'revoked' && principalSessions.length) {
      findings.push(finding(
        `revoked-principal-session:${principal.id}`,
        'critical',
        'Revoked principal still has active sessions',
        `${principal.displayName} is revoked but ${principalSessions.length} active delegated session${principalSessions.length === 1 ? '' : 's'} remain registered.`,
        'Revoke all sessions for this principal immediately and review recent activity.',
        principal.id,
      ));
    }
    if (principal.status === 'active' && principalSessions.length >= 8) {
      findings.push(finding(
        `session-sprawl:${principal.id}`,
        principalSessions.length >= 12 ? 'critical' : 'high',
        'Unusually high delegated-session count',
        `${principal.displayName} currently has ${principalSessions.length} active delegated sessions.`,
        'Confirm the active devices and revoke sessions that are no longer expected.',
        principal.id,
      ));
    }
  }

  const criticalActionFailures = eventCount(last60, (event) => event.category === 'action' && event.severity === 'critical' && event.outcome === 'failure');
  if (criticalActionFailures >= 3) {
    findings.push(finding(
      'critical-action-failures',
      'high',
      'Repeated critical action failures',
      `${criticalActionFailures} critical action failures were recorded during the last hour.`,
      'Review the failed actions before issuing new high-risk approvals.',
    ));
  }

  let latestIncidents = incidents;
  if (options?.persistIncidents) {
    for (const item of findings) await upsertIncident(profileId, item);
    latestIncidents = await listSecurityIncidents(profileId, 500);
  }
  if (options?.notify) await publishIncidentNotifications(profileId, latestIncidents);

  const openIncidents = latestIncidents.filter((item) => item.status !== 'resolved');
  const critical = findings.some((item) => item.severity === 'critical') || openIncidents.some((item) => item.severity === 'critical');
  const elevated = findings.length > 0 || openIncidents.length > 0;
  const posture: SecurityPosture = critical ? 'critical' : elevated ? 'elevated' : 'normal';

  return {
    generatedAt: new Date().toISOString(),
    configured,
    posture,
    integrity,
    findings,
    incidents: latestIncidents.slice(0, 100),
    recentEvents: events.slice(0, 120),
    activeSessions: activeSessions.slice(0, 200).map((item) => ({
      id: item.id,
      principalId: item.principalId,
      assurance: item.assurance,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      lastSeenAt: item.lastSeenAt,
      clientFingerprint: item.clientFingerprint,
    })),
    stats: {
      principals: principals.length,
      activeSessions: activeSessions.length,
      activePasskeys: passkeySets.reduce((count, items) => count + items.length, 0),
      activeDevices: activeDevices.length,
      recentDeniedEvents: eventCount(last60, (event) => event.outcome === 'denied'),
      openIncidents: openIncidents.length,
    },
  };
}

export async function revokeOneSecuritySession(profileId: string, sessionId: string, actorPrincipalId: string) {
  const revoked = await revokePrincipalSession(profileId, sessionId, actorPrincipalId);
  await recordSecurityEventSafe(profileId, {
    category: 'session',
    action: 'session.revoked_by_security',
    outcome: 'success',
    severity: 'high',
    actorPrincipalId,
    subjectId: revoked.principalId,
    sessionId: revoked.id,
  });
  return revoked;
}

export async function revokePrincipalSecuritySessions(profileId: string, principalId: string, actorPrincipalId: string) {
  const revoked = await revokeAllPrincipalSessions(profileId, principalId, actorPrincipalId);
  await recordSecurityEventSafe(profileId, {
    category: 'session',
    action: 'principal.sessions_revoked_by_security',
    outcome: 'success',
    severity: 'high',
    actorPrincipalId,
    subjectId: principalId,
    detail: `${revoked.length} session${revoked.length === 1 ? '' : 's'} revoked.`,
  });
  return revoked;
}

export async function emergencySecurityLockdown(profileId: string, actorPrincipalId: string, includeDevices = false) {
  const sessions = (await listPrincipalSessions(profileId, 1000)).filter((item) => item.status === 'active');
  const revokedSessions = [];
  for (const session of sessions) {
    try { revokedSessions.push(await revokePrincipalSession(profileId, session.id, actorPrincipalId)); } catch { /* best effort across independent sessions */ }
  }
  const revokedDevices = [];
  if (includeDevices) {
    const devices = (await listCompanionDevices(profileId)).filter((item) => item.status === 'active');
    for (const device of devices) {
      try {
        const revoked = await revokeCompanionDevice(profileId, actorPrincipalId, device.id);
        if (revoked) revokedDevices.push(revoked);
      } catch { /* best effort across independent devices */ }
    }
  }
  await recordSecurityEventSafe(profileId, {
    category: 'incident',
    action: 'security.lockdown',
    outcome: 'success',
    severity: 'critical',
    actorPrincipalId,
    detail: `${revokedSessions.length} delegated sessions revoked${includeDevices ? ` and ${revokedDevices.length} companion devices revoked` : ''}.`,
  });
  const manualFinding = finding(
    `manual-lockdown:${new Date().toISOString().slice(0, 13)}`,
    'critical',
    'Emergency security lockdown activated',
    `${revokedSessions.length} delegated sessions were revoked${includeDevices ? ` and ${revokedDevices.length} companion devices were disabled` : ''}.`,
    'Review the security ledger, active principals, and passkeys before reissuing delegated access.',
  );
  const incident = await upsertIncident(profileId, manualFinding);
  await publishIncidentNotifications(profileId, [incident]);
  return { revokedSessions: revokedSessions.length, revokedDevices: revokedDevices.length, incident };
}

export function severityRank(value: SecurityEventSeverity) {
  return value === 'critical' ? 4 : value === 'high' ? 3 : value === 'normal' ? 2 : 1;
}
