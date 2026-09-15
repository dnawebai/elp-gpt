import { getReasoningProviders } from '@/lib/elp';

export type TradingAgentRole =
  | 'market-scout'
  | 'technical-analyst'
  | 'fundamental-analyst'
  | 'news-catalyst'
  | 'quant-researcher'
  | 'risk-officer'
  | 'portfolio-strategist';

export type TradingAgent = {
  id: TradingAgentRole;
  name: string;
  mission: string;
};

export type TradingMission = {
  objective: string;
  universe?: string;
  horizon?: string;
  riskBudget?: string;
  context?: string;
};

export type TradingAgentFinding = {
  agentId: TradingAgentRole;
  agentName: string;
  output: string;
};

export type TradingMissionResult = {
  mode: 'research-and-paper-trading';
  objective: string;
  findings: TradingAgentFinding[];
  synthesis: string;
  generatedAt: string;
};

export const TRADING_AGENTS: readonly TradingAgent[] = [
  { id:'market-scout', name:'Market Scout', mission:'Map the market regime, liquidity, breadth, volatility and candidate instruments. Separate verified observations from assumptions.' },
  { id:'technical-analyst', name:'Technical Analyst', mission:'Evaluate price structure, trend, momentum, support/resistance, volatility and invalidation levels without inventing data.' },
  { id:'fundamental-analyst', name:'Fundamental Analyst', mission:'Assess business quality, valuation drivers, earnings sensitivity, balance-sheet risk and key fundamental catalysts when relevant.' },
  { id:'news-catalyst', name:'News & Catalyst Analyst', mission:'Identify time-sensitive catalysts, event risk, macro drivers and narrative shifts. Flag anything requiring current-data verification.' },
  { id:'quant-researcher', name:'Quant Researcher', mission:'Turn hypotheses into falsifiable rules, features, backtests, benchmarks and paper-trading experiments. Reject overfit logic.' },
  { id:'risk-officer', name:'Risk Officer', mission:'Challenge every thesis, define downside cases, concentration limits, stop conditions, sizing constraints and reasons not to trade.' },
  { id:'portfolio-strategist', name:'Portfolio Strategist', mission:'Synthesize candidate ideas into a diversified research portfolio and paper-trade plan with explicit assumptions and review cadence.' },
] as const;

const VIDEO_BEHAVIOUR_PROMPT = `The reference interaction behaves like an operating system, not a chatbot: accept one objective, pull the relevant information and tools, delegate work to specialist agents, build a visible pipeline, optimize for the objective, surface missing capabilities, and return a clear execution-ready result through a focused UI. Preserve that operating pattern for trading research.`;

async function askHermes(system:string, user:string) {
  const providers = getReasoningProviders().filter((provider) => provider.name === 'hermes');
  if (!providers.length) throw new Error('Hermes is not configured. Set HERMES_BASE_URL and, when required, HERMES_API_KEY.');
  const provider = providers[0];
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method:'POST',
    headers:{'Content-Type':'application/json', ...(provider.apiKey ? {Authorization:`Bearer ${provider.apiKey}`} : {})},
    body:JSON.stringify({model:provider.model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0.2,max_tokens:1100}),
    signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Hermes trading agent failed with ${response.status}.`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Hermes returned an empty trading analysis.');
  return text;
}

function missionContext(mission:TradingMission) {
  return [
    `Objective: ${mission.objective}`,
    mission.universe ? `Universe: ${mission.universe}` : '',
    mission.horizon ? `Horizon: ${mission.horizon}` : '',
    mission.riskBudget ? `Risk budget: ${mission.riskBudget}` : '',
    mission.context ? `Additional context: ${mission.context}` : '',
  ].filter(Boolean).join('\n');
}

export async function runHermesTradingMission(mission:TradingMission):Promise<TradingMissionResult> {
  const context = missionContext(mission);
  const findings = await Promise.all(TRADING_AGENTS.map(async (agent) => {
    const output = await askHermes(
      `You are ${agent.name}, one specialist inside ELP Hermes Trading Mode. ${agent.mission}\n\n${VIDEO_BEHAVIOUR_PROMPT}\n\nSafety boundary: this system is for market research, backtesting and paper trading only. Do not place real trades, move money, connect to a brokerage for execution, or present uncertain data as live/verified. When current market data is absent, say what must be fetched before a conclusion is valid.`,
      `${context}\n\nReturn: observations, thesis, evidence needed, invalidation, risk, and the next research/paper-trading test.`,
    );
    return { agentId:agent.id, agentName:agent.name, output };
  }));

  const synthesisInput = findings.map((finding) => `## ${finding.agentName}\n${finding.output}`).join('\n\n');
  const synthesis = await askHermes(
    `You are the Portfolio Strategist coordinating ELP Hermes Trading Mode. ${VIDEO_BEHAVIOUR_PROMPT}\n\nCreate one integrated research decision from the specialist outputs. Keep facts separate from assumptions. Do not issue or execute real-money trades. Any trade expression must be explicitly labelled PAPER TRADE / HYPOTHETICAL. Require current-data verification before using live prices, spreads, fundamentals, news or volatility.`,
    `${context}\n\nSPECIALIST OUTPUTS:\n${synthesisInput}\n\nReturn sections: Market Regime, Highest-Conviction Hypotheses, What Must Be Verified Now, Paper-Trade Setup(s), Risk Limits & Invalidation, Backtest Plan, Agent Pipeline, Missing Tools/Skills, and Stop Conditions.`,
  );

  return { mode:'research-and-paper-trading', objective:mission.objective, findings, synthesis, generatedAt:new Date().toISOString() };
}

export function hermesTradingPrompt() {
  return `HERMES TRADING MODE\n${VIDEO_BEHAVIOUR_PROMPT}\n- Multi-agent research only.\n- Paper trading and backtesting are permitted.\n- Never autonomously execute real-money trades or transfers.\n- Require current-data verification before live-market conclusions.\n- The Risk Officer can veto any thesis that lacks defined invalidation or uses unverifiable data.`;
}
