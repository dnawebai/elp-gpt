import { getMeeting } from '@/lib/meeting-copilot';
import { addMeetingOutcomeEvidence } from '@/lib/outcome-memory';
import { getTaskBoard, updateTask } from '@/lib/task-router';

export type PreparedMeetingFollowUp = {
  index: number;
  target: string;
  channel: 'email';
  toolSlug: 'GMAIL_SEND_EMAIL';
  arguments: {
    recipient_email: string;
    subject: string;
    body: string;
    is_html: false;
    user_id: 'me';
  };
  summary: string;
};

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@.+]+/g, ' ').trim();
}

function targetParticipant(target: string, participants: Array<{ name: string; organization?: string; email?: string }>) {
  const needle = normalise(target);
  if (!needle) return null;
  const exactEmail = participants.find((participant) => participant.email && participant.email.toLowerCase() === target.trim().toLowerCase());
  if (exactEmail) return exactEmail;
  const matches = participants.filter((participant) => {
    const name = normalise(participant.name);
    const organization = normalise(participant.organization || '');
    return name === needle || organization === needle || (needle.length >= 4 && (name.includes(needle) || needle.includes(name) || (organization && (organization.includes(needle) || needle.includes(organization)))));
  });
  return matches.length === 1 ? matches[0] : null;
}

export async function prepareMeetingFollowUp(profileId: string, meetingId: string, index: number): Promise<PreparedMeetingFollowUp> {
  const meeting = await getMeeting(profileId, meetingId);
  if (meeting.status !== 'completed' || !meeting.finalInsights) throw new Error('Meeting must be finalised before follow-up execution.');
  const followUp = meeting.finalInsights.followUps[index];
  if (!followUp) throw new Error('Follow-up not found.');
  if (followUp.channel !== 'email') throw new Error(`Automated execution for ${followUp.channel} follow-ups is not configured. Keep this item in Command Center or execute it with an approved connected tool.`);

  const participant = targetParticipant(followUp.target, meeting.participants);
  if (!participant?.email) {
    throw new Error(`No unique verified participant email is available for ${followUp.target}. Add the participant email before preparing this send.`);
  }

  const subject = clip(followUp.subject || `Follow-up: ${meeting.title}`, 180);
  const body = clip(followUp.draft, 12000);
  if (!body) throw new Error('Follow-up draft is empty.');
  return {
    index,
    target: followUp.target,
    channel: 'email',
    toolSlug: 'GMAIL_SEND_EMAIL',
    arguments: {
      recipient_email: participant.email,
      subject,
      body,
      is_html: false,
      user_id: 'me',
    },
    summary: `Send approved post-meeting follow-up email to ${participant.name}${participant.organization ? ` at ${participant.organization}` : ''} after ${meeting.title}.`,
  };
}

export async function recordMeetingFollowUpExecuted(profileId: string, meetingId: string, index: number, evidence?: string) {
  const meeting = await getMeeting(profileId, meetingId);
  const followUp = meeting.finalInsights?.followUps[index];
  if (!followUp) throw new Error('Follow-up not found.');
  const description = `Approved ${followUp.channel} follow-up to ${followUp.target} was executed${evidence?.trim() ? `: ${clip(evidence, 600)}` : '.'}`;
  await addMeetingOutcomeEvidence(profileId, meetingId, description).catch(() => null);

  const source = `meeting-follow-up:${meetingId}:${index}`;
  const board = await getTaskBoard(profileId);
  const active = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated];
  const exact = active.find((item) => item.source === source);
  const legacyCandidates = active.filter((item) => item.source === 'meeting-follow-up' && item.objective.toLowerCase().includes(followUp.target.toLowerCase()) && item.objective.toLowerCase().includes(meeting.title.toLowerCase()));
  const task = exact || (legacyCandidates.length === 1 ? legacyCandidates[0] : undefined);
  if (task) {
    await updateTask(profileId, task.id, {
      queue: 'done',
      status: 'completed',
      approval: 'none',
      evidence: clip(evidence || description, 1800),
      summary: `Executed follow-up to ${followUp.target}.`,
    });
  }
  return { ok: true, taskId: task?.id || null, evidence: description };
}
