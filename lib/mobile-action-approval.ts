import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { actionDigest, sanitizeActionArguments, type ActionRisk } from '@/lib/actions';
import {
  recordActionApproved,
  recordActionExecuted,
  recordActionExecuting,
  recordActionFailed,
  recordActionRejected,
} from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability, type Principal } from '@/lib/authority-policy';
import { executeComposioTool, isComposioConfigured } from '@/lib/composio';
import { getElpSessionSecret } from '@/lib/elp-config';
import { listHonchoMessages } from '@/lib/honcho-pagination';
import { sendMobilePush } from '@/lib/mobile-companion';
import { verifyActionToken } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';

export type MobileApprovalStatus = 'pending' | 'approved' | 'executing' | 'executed' | 'rejected' | 'failed' | 'expired';
export type MobileApprovalTicket = {
  id: string;
  principalId: string;
  actionNonce: string;
  digest: string;
  toolSlug: string;
  summary: string;
  risk: Exclude<ActionRisk, 'read'>;
  status: MobileApprovalStatus;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  sealedEnvelope: string;
  deviceId?: string;
  error?: string;
  executedAt?: string;
  rejectedAt?: string;
};
export type MobileApprovalPublic = Omit<MobileApprovalTicket, 'sealedEnvelope' | 'digest'> & {
  argumentPreview: Record<string, unknown>;
};

type MobileActionEnvelope = {
  proposalToken: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  connectedAccountId?: string;
};

const STATUSES = new Set<MobileApprovalStatus>(['pending','approved','executing','executed','rejected','failed','expired']);
const SENSITIVE_KEY = /(pass(word)?|secret|token|authorization|api[_-]?key|credential|private[_-]?key|cookie|session)/i;
const MAX_ENVELOPE_JSON_BYTES = 48_000;

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean=value.trim(); return clean.length<=max?clean:`${clean.slice(0,max)}…`; }
function sealingKey() {
  const secret = getElpSessionSecret();
  if (!secret) return null;
  return createHash('sha256').update(`${secret}:mobile-approval:v1`).digest();
}
function seal(value: MobileActionEnvelope) {
  const key=sealingKey(); if(!key) throw new Error('Native mobile approvals require the dedicated ELP session secret.');
  const plaintext=Buffer.from(JSON.stringify(value));
  if(plaintext.length>MAX_ENVELOPE_JSON_BYTES) throw new Error('Action is too large for native mobile approval. Use the web approval flow.');
  const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]); const tag=cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}
function unseal(value: string): MobileActionEnvelope {
  const key=sealingKey(); if(!key) throw new Error('Native mobile approvals are unavailable.');
  const [version,ivRaw,tagRaw,dataRaw]=value.split('.');
  if(version!=='v1'||!ivRaw||!tagRaw||!dataRaw) throw new Error('Invalid mobile approval envelope.');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(ivRaw,'base64url')); decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  const json=Buffer.concat([decipher.update(Buffer.from(dataRaw,'base64url')),decipher.final()]).toString('utf8');
  const parsed=JSON.parse(json) as MobileActionEnvelope;
  const args=sanitizeActionArguments(parsed.arguments);
  if(!parsed.proposalToken||!parsed.toolSlug||!args) throw new Error('Mobile approval envelope is incomplete.');
  return { proposalToken:parsed.proposalToken,toolSlug:parsed.toolSlug,arguments:args,...(parsed.connectedAccountId?{connectedAccountId:parsed.connectedAccountId}: {}) };
}
async function sessionFor(profileId:string){
  if(!process.env.HONCHO_API_KEY)return null;
  const h=new Honcho({apiKey:process.env.HONCHO_API_KEY,workspaceId:workspaceId(),environment:'production'});
  const user=await h.peer(`user-${profileId}`);const elp=await h.peer('elp');const session=await h.session(`mobile-approvals-${profileId}`);await session.addPeers([user,elp]);return{user,elp,session};
}
function parse(message:{metadata:Record<string,unknown>}):MobileApprovalTicket|null{
  const m=message.metadata||{};if(m.elpMobileApproval!==true||typeof m.ticketJson!=='string')return null;
  try{const ticket=JSON.parse(m.ticketJson) as MobileApprovalTicket;if(!ticket?.id||!ticket.principalId||!ticket.actionNonce||!ticket.sealedEnvelope||!STATUSES.has(ticket.status)||!['write','high'].includes(ticket.risk))return null;if(ticket.status==='pending'&&Date.parse(ticket.expiresAt)<=Date.now())ticket.status='expired';return ticket;}catch{return null;}
}
async function write(profileId:string,ticket:MobileApprovalTicket){const h=await sessionFor(profileId);if(!h)throw new Error('Native mobile approval storage is unavailable.');await h.session.addMessages([{peerId:h.elp.id,content:`[MOBILE_APPROVAL] ${ticket.status} ${ticket.summary}`,metadata:{elpMobileApproval:true,recordVersion:1,ticketId:ticket.id,principalId:ticket.principalId,ticketJson:JSON.stringify(ticket)}}]);return ticket;}
async function update(profileId:string,ticket:MobileApprovalTicket,patch:Partial<MobileApprovalTicket>){return write(profileId,{...ticket,...patch,updatedAt:new Date().toISOString()});}
export function mobileApprovalConfigured(){return Boolean(getElpSessionSecret()&&process.env.HONCHO_API_KEY);}
export async function listMobileApprovalTickets(profileId:string,principalId:string,limit=30){
  const h=await sessionFor(profileId);if(!h)return[] as MobileApprovalTicket[];
  const messages=await listHonchoMessages(h.session,{pageSize:100,maxPages:10,reverse:true});const map=new Map<string,MobileApprovalTicket>();
  for(const message of messages){const ticket=parse(message);if(ticket&&ticket.principalId===principalId&&!map.has(ticket.id))map.set(ticket.id,ticket);}
  return[...map.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,Math.max(1,Math.min(100,limit)));
}
async function findTicket(profileId:string,principalId:string,ticketId:string){return(await listMobileApprovalTickets(profileId,principalId,100)).find((item)=>item.id===ticketId)||null;}
function previewValue(value:unknown,depth=0):unknown{
  if(depth>3)return'[nested]';
  if(typeof value==='string')return value.length<=800?value:`${value.slice(0,800)}…`;
  if(typeof value==='number'||typeof value==='boolean'||value===null)return value;
  if(Array.isArray(value))return value.slice(0,12).map((item)=>previewValue(item,depth+1));
  if(value&&typeof value==='object'){
    const out:Record<string,unknown>={};for(const [key,item]of Object.entries(value as Record<string,unknown>).slice(0,24)){out[key]=SENSITIVE_KEY.test(key)?'[redacted]':previewValue(item,depth+1);}return out;
  }
  return String(value??'');
}
export async function getMobileApprovalInbox(profileId:string,principalId:string){
  const tickets=await listMobileApprovalTickets(profileId,principalId,40);const output:MobileApprovalPublic[]=[];
  for(const ticket of tickets){let argumentPreview:Record<string,unknown>={};try{argumentPreview=previewValue(unseal(ticket.sealedEnvelope).arguments) as Record<string,unknown>;}catch{argumentPreview={notice:'Action details are unavailable; do not approve this ticket.'};}
    const {sealedEnvelope:_,digest:__,...publicTicket}=ticket;output.push({...publicTicket,argumentPreview});}
  return output;
}
export async function queueMobileActionApproval(input:{profileId:string;principalId:string;proposalToken:string;toolSlug:string;arguments:Record<string,unknown>;connectedAccountId?:string;summary:string;risk:ActionRisk;expiresAt:string}){
  if(input.risk==='read'||!mobileApprovalConfigured())return null;
  const proposal=verifyActionToken(input.proposalToken);if(!proposal||proposal.stage!=='proposal'||proposal.profileId!==input.profileId||proposal.principalId!==input.principalId||proposal.risk!==input.risk)return null;
  const args=sanitizeActionArguments(input.arguments);if(!args)return null;const digest=actionDigest({toolSlug:input.toolSlug,arguments:args,connectedAccountId:input.connectedAccountId});if(digest!==proposal.digest)return null;
  const now=new Date().toISOString();const ticket:MobileApprovalTicket={id:randomUUID(),principalId:input.principalId,actionNonce:proposal.nonce,digest,toolSlug:input.toolSlug,summary:clip(input.summary,500),risk:input.risk,status:'pending',createdAt:now,expiresAt:input.expiresAt,updatedAt:now,sealedEnvelope:seal({proposalToken:input.proposalToken,toolSlug:input.toolSlug,arguments:args,...(input.connectedAccountId?{connectedAccountId:input.connectedAccountId}: {})})};
  await write(input.profileId,ticket);
  const push=await sendMobilePush(input.profileId,{principalId:input.principalId,title:input.risk==='high'?'ELP high-risk approval':'ELP approval required',body:ticket.summary,data:{type:'elp_action_approval',ticketId:ticket.id,risk:ticket.risk}}).catch((error)=>{console.error('ELP mobile approval push failed',error);return{sent:0,failed:1};});
  return{ticketId:ticket.id,...push};
}
export async function rejectMobileAction(input:{profileId:string;principalId:string;ticketId:string;deviceId:string}){
  const ticket=await findTicket(input.profileId,input.principalId,input.ticketId);if(!ticket)throw new Error('Approval ticket not found.');if(ticket.status!=='pending')throw new Error(`Approval ticket is already ${ticket.status}.`);if(Date.parse(ticket.expiresAt)<=Date.now()){await update(input.profileId,ticket,{status:'expired',deviceId:input.deviceId});throw new Error('Approval ticket expired.');}
  await recordActionRejected(input.profileId,ticket.actionNonce).catch(()=>undefined);await update(input.profileId,ticket,{status:'rejected',deviceId:input.deviceId,rejectedAt:new Date().toISOString()});
  await recordSecurityEventSafe(input.profileId,{category:'action',action:'action.mobile_rejected',outcome:'success',severity:'normal',actorPrincipalId:input.principalId,subjectId:ticket.actionNonce,detail:ticket.toolSlug}).catch(()=>undefined);
  return{ok:true,status:'rejected' as const,ticketId:ticket.id};
}
function evidencePreview(value:unknown){try{const text=JSON.stringify(value);return text.length<=1800?text:`${text.slice(0,1800)}…`;}catch{return'Execution completed; result was not serializable.';}}
export async function approveAndExecuteMobileAction(input:{profileId:string;principal:Principal;ticketId:string;deviceId:string}){
  const ticket=await findTicket(input.profileId,input.principal.id,input.ticketId);if(!ticket)throw new Error('Approval ticket not found.');if(ticket.status!=='pending')throw new Error(`Approval ticket is already ${ticket.status}.`);if(Date.parse(ticket.expiresAt)<=Date.now()){await update(input.profileId,ticket,{status:'expired',deviceId:input.deviceId});throw new Error('Approval ticket expired.');}
  if(ticket.risk==='high')return{ok:false,status:'step_up_required' as const,ticketId:ticket.id,message:'High-risk actions require a passkey-authenticated ELP owner session. Native biometric confirmation alone does not weaken that boundary.'};
  if(!isComposioConfigured())throw new Error('Connected action execution is unavailable.');
  const capability=requiredApprovalCapability(ticket.risk);if(capability&&!hasCapability(input.principal.role,capability,input.principal.capabilities))throw new Error('Principal is not authorized to approve this action.');
  const envelope=unseal(ticket.sealedEnvelope);const proposal=verifyActionToken(envelope.proposalToken);if(!proposal||proposal.stage!=='proposal'||proposal.profileId!==input.profileId||proposal.principalId!==input.principal.id||proposal.nonce!==ticket.actionNonce||proposal.risk!==ticket.risk)throw new Error('Approval authorization is invalid or expired.');
  const digest=actionDigest({toolSlug:envelope.toolSlug,arguments:envelope.arguments,connectedAccountId:envelope.connectedAccountId});if(digest!==proposal.digest||digest!==ticket.digest||envelope.toolSlug!==ticket.toolSlug)throw new Error('Action changed after it was proposed. Re-plan it.');
  await recordActionApproved(input.profileId,ticket.actionNonce);await update(input.profileId,ticket,{status:'approved',deviceId:input.deviceId});
  await recordActionExecuting(input.profileId,ticket.actionNonce).catch(()=>undefined);await update(input.profileId,ticket,{status:'executing',deviceId:input.deviceId});
  try{
    const result=await executeComposioTool({toolSlug:envelope.toolSlug,arguments:envelope.arguments,profileId:input.profileId,connectedAccountId:envelope.connectedAccountId});
    const executedAt=new Date().toISOString();await recordActionExecuted(input.profileId,ticket.actionNonce,evidencePreview(result)).catch(()=>undefined);await update(input.profileId,ticket,{status:'executed',deviceId:input.deviceId,executedAt});
    await recordSecurityEventSafe(input.profileId,{category:'action',action:'action.mobile_write_approved_and_executed',outcome:'success',severity:'high',actorPrincipalId:input.principal.id,subjectId:ticket.actionNonce,detail:ticket.toolSlug}).catch(()=>undefined);
    return{ok:true,status:'executed' as const,ticketId:ticket.id,summary:ticket.summary};
  }catch(error){const message=error instanceof Error?error.message:'Action execution failed.';await recordActionFailed(input.profileId,ticket.actionNonce,message).catch(()=>undefined);await update(input.profileId,ticket,{status:'failed',deviceId:input.deviceId,error:clip(message,800)});throw error;}
}
