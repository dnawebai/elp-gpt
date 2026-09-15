import { hasCapability } from '@/lib/authority-policy';
import { listApprovalContinuations } from '@/lib/approval-continuations';
import { getAnticipatorySnapshot } from '@/lib/anticipatory-chief-of-staff';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getTaskBoard } from '@/lib/task-router';
import { listTelephonyCalls } from '@/lib/telephony-events';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type VoiceActivationBriefing = {
  ok: true;
  generatedAt: string;
  timezone: string;
  status: 'clear' | 'attention' | 'critical';
  speech: string;
  stats: {
    approvals: number;
    highRiskApprovals: number;
    criticalRisks: number;
    highRisks: number;
    urgentCommitments: number;
    appointments: number;
    decisions: number;
  };
  approvals: Array<{ id: string; summary: string; toolSlug: string; risk: 'read' | 'write' | 'high'; expiresAt: string }>;
  risks: Array<{ id: string; severity: 'critical' | 'high' | 'medium'; title: string; summary: string; horizonHours: number; confidence: number }>;
  commitments: Array<{ id: string; title: string; status: string; dueDate?: string; overdue: boolean; priority: string }>;
  appointments: Array<{ callId: string; with?: string; datetime?: string; locationOrMethod?: string; reference?: string }>;
  decisions: Array<{ id: string; title: string; priority: string; status: string; dueAt?: string }>;
};

const DEFAULT_TIMEZONE = 'America/Toronto';
const MAX_SPEECH = 1400;

function clip(value: string, max: number) {
  const clean = value
    .replace(/https?:\/\/\S+/gi, 'link')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function validTimezone(value?: string) {
  const timezone = value?.trim() || process.env.ELP_BRIEFING_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function riskRank(value: 'read' | 'write' | 'high') {
  return value === 'high' ? 3 : value === 'write' ? 2 : 1;
}

function expiryPhrase(expiresAt: string, now: number) {
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining)) return 'expiry time unavailable';
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  if (minutes < 60) return `expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.ceil(hours / 24);
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}

function commitmentScore(item: { overdue: boolean; status: string; priority: string; dueDate?: string }) {
  const due = item.dueDate ? Date.parse(`${item.dueDate}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return (item.overdue ? 1000 : 0)
    + (item.status === 'blocked' ? 500 : 0)
    + (item.priority === 'high' ? 200 : item.priority === 'medium' ? 100 : 0)
    + (Number.isFinite(due) ? Math.max(0, 100 - Math.floor((due - Date.now()) / 86_400_000)) : 0);
}

function appointmentTime(value?: string) {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAppointment(value: string | undefined, timezone: string) {
  if (!value) return undefined;
  const parsed = appointmentTime(value);
  if (parsed === null) return clip(value, 100);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(parsed));
  } catch {
    return clip(value, 100);
  }
}

export async function buildVoiceActivationBriefing(
  context: ZeroTrustAuthorityContext,
  timezoneInput?: string,
): Promise<VoiceActivationBriefing> {
  const timezone = validTimezone(timezoneInput);
  const now = Date.now();
  const [continuations, forecast, ledger, board, calls] = await Promise.all([
    listApprovalContinuations(context.profileId).catch(() => []),
    getAnticipatorySnapshot(context.profileId).catch(() => null),
    getExecutiveLedger(context.profileId).catch(() => null),
    getTaskBoard(context.profileId).catch(() => null),
    listTelephonyCalls(context.profileId, 120).catch(() => []),
  ]);

  const canApproveWrite = hasCapability(context.principal.role, 'approve_write', context.principal.capabilities);
  const canApproveHigh = hasCapability(context.principal.role, 'approve_high_risk', context.principal.capabilities);
  const approvals = continuations
    .filter((item) => item.status === 'pending')
    .filter((item) => item.risk === 'high' ? canApproveHigh : item.risk === 'write' ? canApproveWrite : true)
    .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      summary: clip(item.summary, 180),
      toolSlug: clip(item.toolSlug, 120),
      risk: item.risk,
      expiresAt: item.expiresAt,
    }));

  const risks = (forecast?.risks || [])
    .filter((item) => item.severity === 'critical' || item.severity === 'high')
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      severity: item.severity,
      title: clip(item.title, 150),
      summary: clip(item.summary, 220),
      horizonHours: item.horizonHours,
      confidence: item.confidence,
    }));

  const commitments = (ledger?.items || [])
    .filter((item) => item.primaryKind === 'commitment' && (item.status === 'active' || item.status === 'blocked'))
    .filter((item) => item.overdue || item.status === 'blocked' || item.priority === 'high' || (item.dueDate && Date.parse(`${item.dueDate}T23:59:59.999Z`) - now <= 7 * 86_400_000))
    .sort((a, b) => commitmentScore(b) - commitmentScore(a))
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      title: clip(item.title, 160),
      status: item.status,
      ...(item.dueDate ? { dueDate: item.dueDate } : {}),
      overdue: item.overdue,
      priority: item.priority,
    }));

  const seenAppointments = new Set<string>();
  const appointments = calls
    .filter((call) => call.analysis?.appointmentBooked === true)
    .filter((call) => {
      const time = appointmentTime(call.analysis?.appointmentDatetime);
      if (time !== null) return time >= now - 30 * 60_000 && time <= now + 30 * 86_400_000;
      const updated = Date.parse(call.updatedAt);
      return Number.isFinite(updated) && updated >= now - 7 * 86_400_000;
    })
    .sort((a, b) => {
      const aTime = appointmentTime(a.analysis?.appointmentDatetime) ?? Number.POSITIVE_INFINITY;
      const bTime = appointmentTime(b.analysis?.appointmentDatetime) ?? Number.POSITIVE_INFINITY;
      return aTime - bTime || b.updatedAt.localeCompare(a.updatedAt);
    })
    .filter((call) => {
      const key = call.analysis?.appointmentReference
        || `${call.analysis?.appointmentDatetime || ''}|${call.analysis?.appointmentWith || ''}`
        || call.callId;
      if (seenAppointments.has(key)) return false;
      seenAppointments.add(key);
      return true;
    })
    .slice(0, 3)
    .map((call) => ({
      callId: call.callId,
      ...(call.analysis?.appointmentWith ? { with: clip(call.analysis.appointmentWith, 120) } : {}),
      ...(call.analysis?.appointmentDatetime ? { datetime: formatAppointment(call.analysis.appointmentDatetime, timezone) } : {}),
      ...(call.analysis?.appointmentLocationOrMethod ? { locationOrMethod: clip(call.analysis.appointmentLocationOrMethod, 120) } : {}),
      ...(call.analysis?.appointmentReference ? { reference: clip(call.analysis.appointmentReference, 120) } : {}),
    }));

  const decisions = (board?.queues.decisions || [])
    .filter((item) => item.status === 'active' || item.status === 'blocked')
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      title: clip(item.title, 170),
      priority: item.priority,
      status: item.status,
      ...(item.dueAt ? { dueAt: item.dueAt } : {}),
    }));

  const highRiskApprovals = approvals.filter((item) => item.risk === 'high').length;
  const criticalRisks = risks.filter((item) => item.severity === 'critical').length;
  const highRisks = risks.filter((item) => item.severity === 'high').length;
  const urgentCommitments = commitments.length;
  const criticalApproval = approvals.some((item) => item.risk === 'high' && Date.parse(item.expiresAt) - now <= 30 * 60_000);
  const status: VoiceActivationBriefing['status'] = criticalRisks > 0 || criticalApproval
    ? 'critical'
    : approvals.length || highRisks || urgentCommitments || appointments.length || decisions.length
      ? 'attention'
      : 'clear';

  const sections: string[] = [];
  if (approvals.length) {
    const top = approvals[0];
    sections.push(`You have ${approvals.length} approval${approvals.length === 1 ? '' : 's'} waiting${highRiskApprovals ? `, including ${highRiskApprovals} high risk` : ''}. Most urgent: ${top.summary}; ${expiryPhrase(top.expiresAt, now)}.`);
  }
  if (risks.length) {
    const top = risks[0];
    sections.push(`Forecast: ${criticalRisks} critical and ${highRisks} high risk${criticalRisks + highRisks === 1 ? '' : 's'}. Top item: ${top.title}.`);
  }
  if (commitments.length) {
    const overdue = commitments.filter((item) => item.overdue).length;
    const blocked = commitments.filter((item) => item.status === 'blocked').length;
    const top = commitments[0];
    sections.push(`Commitments: ${commitments.length} need attention${overdue ? `, ${overdue} overdue` : ''}${blocked ? `, ${blocked} blocked` : ''}. Priority: ${top.title}.`);
  }
  if (appointments.length) {
    const top = appointments[0];
    const appointment = [top.with ? `with ${top.with}` : 'confirmed', top.datetime ? `on ${top.datetime}` : '', top.locationOrMethod ? `via ${top.locationOrMethod}` : ''].filter(Boolean).join(' ');
    sections.push(`Appointment${appointments.length === 1 ? '' : 's'}: ${appointments.length} confirmed. Next: ${appointment}.`);
  }
  if (decisions.length) {
    sections.push(`Decisions: ${decisions.length} waiting. Highest priority: ${decisions[0].title}.`);
  }
  if (!sections.length) {
    sections.push('No urgent approvals, high-severity forecasts, overdue or blocked commitments, confirmed near-term appointments, or priority decisions need your attention.');
  } else {
    sections.push('That is the priority brief. I can open any item or act where your authority permits.');
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    timezone,
    status,
    speech: clip(sections.join(' '), MAX_SPEECH),
    stats: {
      approvals: approvals.length,
      highRiskApprovals,
      criticalRisks,
      highRisks,
      urgentCommitments,
      appointments: appointments.length,
      decisions: decisions.length,
    },
    approvals,
    risks,
    commitments,
    appointments,
    decisions,
  };
}
