import { getReasoningProviders } from '@/lib/elp';

export type AgentDomain =
  | 'strategy' | 'research' | 'marketing' | 'sales' | 'content' | 'product'
  | 'engineering' | 'automation' | 'finance' | 'legal' | 'security' | 'operations';

export type ElpAgent = {
  id: string;
  name: string;
  domain: AgentDomain;
  mission: string;
  skills: string[];
  canProposeSkills: boolean;
};

export const ELP_AGENTS: readonly ElpAgent[] = [
  { id:'chief-strategist', name:'Chief Strategist', domain:'strategy', mission:'Turn an objective into a measurable strategy, assumptions, constraints, milestones and kill criteria.', skills:['strategy','prioritization','scenario analysis','goal decomposition'], canProposeSkills:true },
  { id:'market-intelligence', name:'Market Intelligence', domain:'research', mission:'Analyse market structure, competitors, demand, positioning, evidence and information gaps.', skills:['research','competitive intelligence','trend analysis','evidence grading'], canProposeSkills:true },
  { id:'growth-architect', name:'Growth Architect', domain:'marketing', mission:'Design acquisition loops, offers, channels, experiments and measurable growth plans.', skills:['growth','funnel design','distribution','experimentation'], canProposeSkills:true },
  { id:'revenue-operator', name:'Revenue Operator', domain:'sales', mission:'Find practical paths to revenue, pipeline, conversion, pricing and sales execution.', skills:['sales','pricing','pipeline','conversion'], canProposeSkills:true },
  { id:'content-studio', name:'Content Studio', domain:'content', mission:'Create content angles, scripts, hooks, editorial systems and channel-specific plans.', skills:['copywriting','video concepts','social content','editorial planning'], canProposeSkills:true },
  { id:'product-architect', name:'Product Architect', domain:'product', mission:'Translate user needs into product requirements, UX flows, experiments and product decisions.', skills:['product management','UX','roadmapping','experimentation'], canProposeSkills:true },
  { id:'software-engineer', name:'Software Engineer', domain:'engineering', mission:'Design implementation architecture, code changes, tests, migrations and deployment plans.', skills:['software architecture','coding','testing','deployment'], canProposeSkills:true },
  { id:'automation-engineer', name:'Automation Engineer', domain:'automation', mission:'Connect APIs and workflows, remove manual work and design reliable automations.', skills:['APIs','connectors','workflow design','observability'], canProposeSkills:true },
  { id:'finance-analyst', name:'Finance Analyst', domain:'finance', mission:'Model unit economics, budgets, ROI, scenarios, cash impact and financial constraints.', skills:['financial modelling','unit economics','ROI','forecasting'], canProposeSkills:true },
  { id:'legal-risk', name:'Legal & Risk', domain:'legal', mission:'Identify legal, regulatory, contractual and compliance risks without pretending to replace counsel.', skills:['issue spotting','compliance','contract review','risk framing'], canProposeSkills:true },
  { id:'security-reviewer', name:'Security Reviewer', domain:'security', mission:'Threat-model proposed systems and identify identity, data, authorization and abuse risks.', skills:['threat modelling','zero trust','privacy','security review'], canProposeSkills:true },
  { id:'operations-chief', name:'Operations Chief', domain:'operations', mission:'Convert plans into owners, sequence, dependencies, checkpoints, SOPs and execution cadence.', skills:['operations','SOPs','project control','execution'], canProposeSkills:true },
] as const;

export type AgentFinding = { agentId:string; agentName:string; domain:AgentDomain; output:string };
export type SkillCandidate = { name:string; purpose:string; domain:string; inputs:string[]; outputs:string[]; connectors:string[]; validation:string[] };
export type SeriousMission = { objective:string; findings:AgentFinding[]; synthesis:string; skillCandidates:SkillCandidate[]; generatedAt:string };

function parseJsonBlock(text:string) {
  const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/(\{[\s\S]*\})/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

async function askAgent(agent: ElpAgent, objective: string, context: string) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No ELP reasoning provider configured.');
  const prompt = `You are the ${agent.name} agent inside ELP Serious Mode.\nDomain: ${agent.domain}.\nMission: ${agent.mission}\nCapabilities: ${agent.skills.join(', ')}.\n\nObjective: ${objective}\n\nContext:\n${context || 'No additional context supplied.'}\n\nReturn a concise expert analysis with: facts vs assumptions, highest-leverage actions, measurable tests, risks, and any missing capability that should become a reusable skill. Do not claim actions were executed.`;
  const failures:string[]=[];
  for (const provider of providers) {
    try {
      const r = await fetch(`${provider.baseUrl}/chat/completions`, { method:'POST', headers:{'Content-Type':'application/json', ...(provider.apiKey?{Authorization:`Bearer ${provider.apiKey}`}:{})}, body:JSON.stringify({model:provider.model,messages:[{role:'system',content:'Be precise, practical, evidence-aware and concise.'},{role:'user',content:prompt}],temperature:0.25,max_tokens:900}), signal:AbortSignal.timeout(provider.name==='hermes'?15000:30000) });
      if (!r.ok) { failures.push(`${provider.name}:${r.status}`); continue; }
      const data = await r.json() as {choices?:Array<{message?:{content?:string}}>} ;
      const text=data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
      failures.push(`${provider.name}:empty`);
    } catch (e) { failures.push(`${provider.name}:${e instanceof Error?e.name:'error'}`); }
  }
  throw new Error(`Agent ${agent.id} failed (${failures.join(', ')}).`);
}

function chooseAgents(objective:string, maxAgents=7) {
  const q=objective.toLowerCase();
  const scored=ELP_AGENTS.map(agent=>({agent,score: agent.skills.reduce((n,k)=>n+(q.includes(k.split(' ')[0].toLowerCase())?2:0),0) + (q.includes(agent.domain)?4:0)}));
  const always=['chief-strategist','operations-chief','market-intelligence'];
  for (const x of scored) if (always.includes(x.agent.id)) x.score+=5;
  return scored.sort((a,b)=>b.score-a.score).slice(0,Math.max(3,Math.min(maxAgents,ELP_AGENTS.length))).map(x=>x.agent);
}

export async function runSeriousMission(args:{objective:string;context?:string;maxAgents?:number}):Promise<SeriousMission> {
  const agents=chooseAgents(args.objective,args.maxAgents||7);
  const findings=await Promise.all(agents.map(async agent=>({agentId:agent.id,agentName:agent.name,domain:agent.domain,output:await askAgent(agent,args.objective,args.context||'')})));
  const synthesisAgent=ELP_AGENTS[0];
  const synthesisInput=findings.map(f=>`## ${f.agentName}\n${f.output}`).join('\n\n');
  const synthesis=await askAgent(synthesisAgent,`SYNTHESIZE THIS MISSION: ${args.objective}`,`${synthesisInput}\n\nProduce one integrated execution plan with a numbered step guide, owners/agent roles, measurable targets, assumptions, dependencies, stop conditions and a final section titled SKILL CANDIDATES. For each missing reusable capability, output a JSON code block containing an array under key skillCandidates with objects: name,purpose,domain,inputs,outputs,connectors,validation.`);
  const parsed=parseJsonBlock(synthesis) as {skillCandidates?:SkillCandidate[]} | null;
  return { objective:args.objective, findings, synthesis, skillCandidates:Array.isArray(parsed?.skillCandidates)?parsed!.skillCandidates:[], generatedAt:new Date().toISOString() };
}

export function agentSwarmToPrompt(){
  return `ELP SERIOUS MODE AGENTS:\n${ELP_AGENTS.map(a=>`- ${a.name} (${a.domain}): ${a.mission}`).join('\n')}\nUse the Serious Mode agent swarm for complex multi-domain objectives. Agents may propose new reusable skills, but proposed skills must be validated and approved before installation or production use.`;
}
