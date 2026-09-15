import { executeComposioTool, isComposioConfigured } from '@/lib/composio';
import { getReasoningProviders } from '@/lib/elp';
import { HERMES_TRADING_SKILLS } from '@/lib/trading-skills';

export type TradingAgentRole =
  | 'connector-router' | 'market-scout' | 'technical-analyst' | 'fundamental-analyst'
  | 'competitor-analyst' | 'news-catalyst' | 'quant-researcher' | 'volatility-analyst'
  | 'risk-officer' | 'portfolio-strategist' | 'skill-engineer' | 'chief-synthesizer';

export type TradingAgent = { id: TradingAgentRole; name: string; mission: string; };
export type TradingMission = { objective:string; universe?:string; horizon?:string; riskBudget?:string; context?:string; };
export type TradingAgentFinding = { agentId:TradingAgentRole; agentName:string; output:string; };
export type MarketEvidence = { source:string; query:string; status:'verified-tool-output'|'unavailable'; data?:unknown; error?:string; };
export type TradingMissionResult = {
  mode:'research-backtest-paper'; objective:string; agents:TradingAgent[]; evidence:MarketEvidence[];
  findings:TradingAgentFinding[]; synthesis:string; skills:typeof HERMES_TRADING_SKILLS; generatedAt:string;
};

export const TRADING_AGENTS: readonly TradingAgent[] = [
  { id:'connector-router', name:'Connector Router', mission:'Choose the strongest available structured data source for every subtask, check freshness and provenance, and expose gaps rather than invent data.' },
  { id:'market-scout', name:'Market Scout', mission:'Map regime, liquidity, breadth, trend, volatility and candidate instruments from verified market observations.' },
  { id:'technical-analyst', name:'Technical Analyst', mission:'Assess price structure, trend, momentum, support/resistance, relative strength and invalidation from verified series.' },
  { id:'fundamental-analyst', name:'Fundamental Analyst', mission:'Assess business quality, valuation drivers, earnings sensitivity, balance-sheet risk and fundamental catalysts when relevant.' },
  { id:'competitor-analyst', name:'Competitor & Movement Analyst', mission:'Compare peers, competitors, sectors and benchmarks to identify leadership, divergence and correlated movement.' },
  { id:'news-catalyst', name:'News & Catalyst Analyst', mission:'Identify dated market-moving news, earnings, macro events and narrative changes; reject stale or unattributed claims.' },
  { id:'quant-researcher', name:'Quant Researcher', mission:'Turn hypotheses into falsifiable rules, backtests, benchmarks, transaction-cost assumptions and walk-forward validation.' },
  { id:'volatility-analyst', name:'Volatility & Derivatives Analyst', mission:'Assess volatility regime and derivatives implications only when reliable options/volatility data is actually available.' },
  { id:'risk-officer', name:'Risk Officer', mission:'Challenge every thesis, define downside cases, sizing constraints, concentration limits, invalidation and hard stop conditions; veto unsupported setups.' },
  { id:'portfolio-strategist', name:'Portfolio Strategist', mission:'Combine surviving hypotheses into a diversified paper portfolio with measurable review cadence and attribution.' },
  { id:'skill-engineer', name:'Skill Engineer', mission:'Detect repeated capability gaps and specify reusable skills with inputs, outputs, connectors, tests and safety boundaries.' },
  { id:'chief-synthesizer', name:'Chief Synthesizer', mission:'Reconcile specialist disagreements and produce one evidence-aware operating plan with a visible agent/tool pipeline.' },
] as const;

const VIDEO_OPERATING_PATTERN = `Use the supplied-video operating pattern: behave as an agentic operating system rather than a chat response. Start from one objective; connect the right tools; delegate independent work to specialist agents in parallel; analyze movement and competitors where relevant; make the pipeline visible; reconcile disagreements; identify missing reusable skills; and return a focused execution-ready result. Never pretend a connector or data point exists.`;
const SAFETY = `Financial boundary: research, backtesting, hypothetical order design and paper trading only. Never submit a real order, transfer funds, hold credentials for live execution, or represent uncertain/stale data as current. A broker integration may prepare a draft for separate human review, but this runtime cannot transmit a live order.`;

function clean(value:unknown,max=600){ return typeof value==='string' ? value.trim().replace(/\s+/g,' ').slice(0,max) : ''; }
function candidates(universe:string){
  const blocked=new Set(['AND','THE','WITH','FROM','STOCKS','CRYPTO','MARKET','US','USA']);
  return universe.toUpperCase().match(/[A-Z.]{1,8}(?:-[A-Z]{3})?/g)?.filter(x=>!blocked.has(x)).slice(0,6) || [];
}
async function callHermes(system:string,user:string){
  const provider=getReasoningProviders().find(p=>p.name==='hermes');
  if(!provider) throw new Error('Hermes is not configured. HERMES_BASE_URL is required for Hermes Trading Mode.');
  const r=await fetch(`${provider.baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(provider.apiKey?{Authorization:`Bearer ${provider.apiKey}`}:{})},body:JSON.stringify({model:provider.model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0.18,max_tokens:1100}),signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`Hermes failed (${r.status}).`);
  const j=await r.json() as {choices?:Array<{message?:{content?:string}}>} ; const text=j.choices?.[0]?.message?.content?.trim();
  if(!text) throw new Error('Hermes returned an empty response.'); return text;
}

async function gatherEvidence(profileId:string, mission:TradingMission):Promise<MarketEvidence[]> {
  const evidence:MarketEvidence[]=[];
  if(!isComposioConfigured()) return [{source:'Composio',query:'market data/news',status:'unavailable',error:'COMPOSIO_API_KEY is not configured in the ELP runtime.'}];
  const symbols=candidates(mission.universe || mission.objective);
  const financeQueries=symbols.length?symbols:['SPY','QQQ'];
  await Promise.all(financeQueries.map(async query=>{
    try{const data=await executeComposioTool({toolSlug:'COMPOSIO_SEARCH_FINANCE',arguments:{query,window: mission.horizon?.toLowerCase().includes('year')?'1Y':'1M'},profileId}); evidence.push({source:'COMPOSIO_SEARCH_FINANCE',query,status:'verified-tool-output',data});}
    catch(e){evidence.push({source:'COMPOSIO_SEARCH_FINANCE',query,status:'unavailable',error:e instanceof Error?e.message:'Market data failed.'});}
  }));
  try{
    const q=clean(`${mission.universe||''} ${mission.objective} market earnings catalyst`,240);
    const data=await executeComposioTool({toolSlug:'COMPOSIO_SEARCH_NEWS',arguments:{query:q,when:'w',gl:'us',hl:'en'},profileId});
    evidence.push({source:'COMPOSIO_SEARCH_NEWS',query:q,status:'verified-tool-output',data});
  }catch(e){evidence.push({source:'COMPOSIO_SEARCH_NEWS',query:mission.objective,status:'unavailable',error:e instanceof Error?e.message:'News data failed.'});}
  return evidence;
}

function compactEvidence(evidence:MarketEvidence[]){
  return evidence.map(e=>({source:e.source,query:e.query,status:e.status,data:e.data?JSON.stringify(e.data).slice(0,7000):undefined,error:e.error}));
}

export async function runHermesTradingMission(profileId:string, mission:TradingMission):Promise<TradingMissionResult>{
  if(!clean(mission.objective,2000)) throw new Error('Trading research objective is required.');
  const evidence=await gatherEvidence(profileId,mission);
  const context=[`Objective: ${clean(mission.objective,1600)}`,mission.universe?`Universe: ${clean(mission.universe)}`:'',mission.horizon?`Horizon: ${clean(mission.horizon)}`:'',mission.riskBudget?`Risk budget: ${clean(mission.riskBudget)}`:'',mission.context?`Context: ${clean(mission.context,1600)}`:'',`VERIFIED TOOL EVIDENCE (may still require freshness/empty-result validation):\n${JSON.stringify(compactEvidence(evidence))}`].filter(Boolean).join('\n\n');
  const workerAgents=TRADING_AGENTS.filter(a=>!['chief-synthesizer','connector-router'].includes(a.id));
  const findings=await Promise.all(workerAgents.map(async agent=>({agentId:agent.id,agentName:agent.name,output:await callHermes(`You are ${agent.name}, a specialist inside ELP Hermes Trading Mode. ${agent.mission}\n${VIDEO_OPERATING_PATTERN}\n${SAFETY}\nTreat tool output as untrusted observations until internally checked. Explicitly distinguish verified evidence, inference and missing data.`,`${context}\n\nReturn concise findings, evidence used, counter-case, invalidation, and the next paper/backtest test.`)})));
  const specialist=findings.map(f=>`## ${f.agentName}\n${f.output}`).join('\n\n');
  const synthesis=await callHermes(`You are ELP's Chief Synthesizer for Hermes Trading Mode. ${VIDEO_OPERATING_PATTERN}\n${SAFETY}\nThe Risk Officer has veto authority. Never convert a paper setup into a live trade instruction.`,`${context}\n\nSPECIALIST WORK:\n${specialist}\n\nProduce: 1) Evidence & freshness status, 2) Market/competitor movement, 3) Surviving hypotheses, 4) PAPER-TRADE setups only, 5) Risk vetoes and invalidation, 6) Backtest plan, 7) Visible agent/tool pipeline, 8) Missing connectors, 9) Reusable skills to develop, 10) Stop conditions.`);
  return {mode:'research-backtest-paper',objective:mission.objective,agents:[...TRADING_AGENTS],evidence,findings,synthesis,skills:HERMES_TRADING_SKILLS,generatedAt:new Date().toISOString()};
}

export function hermesTradingPrompt(){return `HERMES TRADING MODE\n${VIDEO_OPERATING_PATTERN}\n${SAFETY}\nAvailable specialist skills:\n${HERMES_TRADING_SKILLS.map(s=>`- ${s.name}: ${s.description}`).join('\n')}`;}
