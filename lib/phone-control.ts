import { executeComposioTool } from '@/lib/composio';

export type PhoneReadiness = {
  configured: boolean;
  available: boolean;
  phoneNumbers: Array<{ number: string; inboundAgentId?: string; outboundAgentId?: string; raw?: Record<string, unknown> }>;
  agents: Array<{ id: string; name?: string; raw?: Record<string, unknown> }>;
  error?: string;
};

function walkObjects(value: unknown, output: Record<string, unknown>[] = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) { value.forEach((item) => walkObjects(item, output)); return output; }
  const object = value as Record<string, unknown>; output.push(object); Object.values(object).forEach((item) => walkObjects(item, output)); return output;
}

export async function getPhoneReadiness(profileId: string): Promise<PhoneReadiness> {
  try {
    const [numbersRaw, agentsRaw] = await Promise.all([
      executeComposioTool({ toolSlug: 'RETELLAI_LIST_ALL_PHONE_NUMBERS', arguments: {}, profileId }),
      executeComposioTool({ toolSlug: 'RETELLAI_LIST_AGENTS', arguments: {}, profileId }),
    ]);
    const numberObjects = walkObjects(numbersRaw).filter((item) => typeof item.phone_number === 'string' || typeof item.phoneNumber === 'string');
    const phoneNumbers = numberObjects.map((item) => ({ number: String(item.phone_number || item.phoneNumber), ...(typeof item.inbound_agent_id === 'string' ? { inboundAgentId: item.inbound_agent_id } : {}), ...(typeof item.outbound_agent_id === 'string' ? { outboundAgentId: item.outbound_agent_id } : {}), raw: item })).filter((item, index, list) => list.findIndex((other) => other.number === item.number) === index);
    const agentObjects = walkObjects(agentsRaw).filter((item) => typeof item.agent_id === 'string' || typeof item.agentId === 'string');
    const agents = agentObjects.map((item) => ({ id: String(item.agent_id || item.agentId), ...(typeof item.agent_name === 'string' ? { name: item.agent_name } : typeof item.name === 'string' ? { name: item.name } : {}), raw: item })).filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index);
    return { configured: true, available: phoneNumbers.length > 0 && agents.length > 0, phoneNumbers, agents };
  } catch (error) {
    return { configured: false, available: false, phoneNumbers: [], agents: [], error: error instanceof Error ? error.message.slice(0, 300) : 'Phone provider unavailable.' };
  }
}

export function prepareOutboundPhoneAction(input: { fromNumber: string; toNumber: string; agentId?: string; purpose?: string; metadata?: Record<string, unknown> }) {
  const e164 = /^\+[1-9]\d{7,14}$/;
  if (!e164.test(input.fromNumber) || !e164.test(input.toNumber)) throw new Error('Both phone numbers must be valid E.164 numbers.');
  const variables: Record<string, string> = {};
  if (input.purpose?.trim()) variables.elp_call_purpose = input.purpose.trim().slice(0, 1000);
  return {
    toolSlug: 'RETELLAI_CREATE_A_NEW_OUTBOUND_PHONE_CALL',
    arguments: {
      from_number: input.fromNumber,
      to_number: input.toNumber,
      ...(input.agentId?.trim() ? { override_agent_id: input.agentId.trim().slice(0, 180) } : {}),
      ...(Object.keys(variables).length ? { retell_llm_dynamic_variables: variables } : {}),
      metadata: { source: 'elp-mission-control', ...(input.metadata || {}) },
    },
    summary: `Place an ELP outbound call to ${input.toNumber}${input.purpose ? ` regarding ${input.purpose.slice(0, 120)}` : ''}`,
  };
}
