import { executeComposioTool } from '@/lib/composio';

export type PhoneReadiness = {
  configured: boolean;
  available: boolean;
  phoneNumbers: Array<{
    number: string;
    inboundAgentId?: string;
    outboundAgentId?: string;
    inboundAgentIds?: string[];
    outboundAgentIds?: string[];
  }>;
  agents: Array<{ id: string; name?: string }>;
  error?: string;
};

function walkObjects(value: unknown, output: Record<string, unknown>[] = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach((item) => walkObjects(item, output));
    return output;
  }
  const object = value as Record<string, unknown>;
  output.push(object);
  Object.values(object).forEach((item) => walkObjects(item, output));
  return output;
}

function clip(value: string | undefined, max: number) {
  const clean = value?.trim() || '';
  return clean.slice(0, max);
}

function readAgentIds(item: Record<string, unknown>, direction: 'inbound' | 'outbound') {
  const ids: string[] = [];
  const legacy = item[`${direction}_agent_id`];
  if (typeof legacy === 'string' && legacy.trim()) ids.push(legacy.trim());

  const weighted = item[`${direction}_agents`];
  if (Array.isArray(weighted)) {
    for (const entry of weighted) {
      if (!entry || typeof entry !== 'object') continue;
      const id = (entry as Record<string, unknown>).agent_id;
      if (typeof id === 'string' && id.trim()) ids.push(id.trim());
    }
  }

  return [...new Set(ids)];
}

export async function getPhoneReadiness(profileId: string): Promise<PhoneReadiness> {
  try {
    const [numbersRaw, agentsRaw] = await Promise.all([
      executeComposioTool({ toolSlug: 'RETELLAI_LIST_ALL_PHONE_NUMBERS', arguments: {}, profileId }),
      executeComposioTool({ toolSlug: 'RETELLAI_LIST_AGENTS', arguments: {}, profileId }),
    ]);

    const numberObjects = walkObjects(numbersRaw).filter(
      (item) => typeof item.phone_number === 'string' || typeof item.phoneNumber === 'string',
    );

    const phoneNumbers = numberObjects
      .map((item) => {
        const inboundAgentIds = readAgentIds(item, 'inbound');
        const outboundAgentIds = readAgentIds(item, 'outbound');
        return {
          number: String(item.phone_number || item.phoneNumber),
          ...(inboundAgentIds[0] ? { inboundAgentId: inboundAgentIds[0] } : {}),
          ...(outboundAgentIds[0] ? { outboundAgentId: outboundAgentIds[0] } : {}),
          ...(inboundAgentIds.length ? { inboundAgentIds } : {}),
          ...(outboundAgentIds.length ? { outboundAgentIds } : {}),
        };
      })
      .filter((item, index, list) => list.findIndex((other) => other.number === item.number) === index);

    const agentObjects = walkObjects(agentsRaw).filter(
      (item) => typeof item.agent_id === 'string' || typeof item.agentId === 'string',
    );
    const agents = agentObjects
      .map((item) => ({
        id: String(item.agent_id || item.agentId),
        ...(typeof item.agent_name === 'string'
          ? { name: item.agent_name }
          : typeof item.name === 'string'
            ? { name: item.name }
            : {}),
      }))
      .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);

    return {
      configured: true,
      available: phoneNumbers.some((number) => Boolean(number.outboundAgentId)) && agents.length > 0,
      phoneNumbers,
      agents,
    };
  } catch (error) {
    return {
      configured: false,
      available: false,
      phoneNumbers: [],
      agents: [],
      error: error instanceof Error ? error.message.slice(0, 300) : 'Phone provider unavailable.',
    };
  }
}

export function prepareOutboundPhoneAction(input: {
  fromNumber: string;
  toNumber: string;
  agentId?: string;
  purpose?: string;
  principalName?: string;
  businessName?: string;
  timezone?: string;
  candidateSlots?: string[];
  appointmentDurationMinutes?: number;
  metadata?: Record<string, unknown>;
}) {
  const e164 = /^\+[1-9]\d{7,14}$/;
  if (!e164.test(input.fromNumber) || !e164.test(input.toNumber)) {
    throw new Error('Both phone numbers must be valid E.164 numbers.');
  }

  const purpose = clip(input.purpose, 1000);
  const principalName = clip(input.principalName, 160) || 'the ELP GPT user';
  const businessName = clip(input.businessName, 200);
  const timezone = clip(input.timezone, 100) || 'America/Toronto';
  const candidateSlots = (input.candidateSlots || [])
    .filter((slot): slot is string => typeof slot === 'string' && Boolean(slot.trim()))
    .slice(0, 8)
    .map((slot) => clip(slot, 160));
  const duration = Math.max(5, Math.min(480, Math.round(input.appointmentDurationMinutes || 30)));
  const appointmentWorkflow = Boolean(purpose || businessName || candidateSlots.length);

  const beginMessage = appointmentWorkflow
    ? `Hello, this is ELP GPT, an AI assistant calling on behalf of ${principalName}. I'm calling${businessName ? ` ${businessName}` : ''} regarding ${purpose || 'an appointment'}.`
    : `Hello, this is ELP GPT, an AI assistant calling on behalf of ${principalName}.`;

  const variables: Record<string, string> = {
    elp_call_mode: 'outbound',
    elp_principal_name: principalName,
    elp_business_name: businessName,
    elp_call_purpose: purpose || 'complete the requested phone call',
    elp_candidate_slots: candidateSlots.join(' | '),
    elp_timezone: timezone,
    elp_appointment_duration_minutes: String(duration),
    elp_begin_message: beginMessage.slice(0, 600),
  };

  return {
    toolSlug: 'RETELLAI_CREATE_A_NEW_OUTBOUND_PHONE_CALL',
    arguments: {
      from_number: input.fromNumber,
      to_number: input.toNumber,
      ...(input.agentId?.trim() ? { override_agent_id: input.agentId.trim().slice(0, 180) } : {}),
      retell_llm_dynamic_variables: variables,
      metadata: {
        source: 'elp-gpt',
        workflow: appointmentWorkflow ? 'appointment-scheduling' : 'outbound-call',
        timezone,
        candidate_slots: candidateSlots,
        appointment_duration_minutes: duration,
        ...(businessName ? { business_name: businessName } : {}),
        ...(input.metadata || {}),
      },
    },
    summary: `Place an ELP outbound call to ${businessName || input.toNumber}${purpose ? ` regarding ${purpose.slice(0, 120)}` : ''}`,
    risk: 'write' as const,
  };
}
