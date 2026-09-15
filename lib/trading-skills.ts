import type { ElpSkill } from '@/lib/skills';

export const HERMES_TRADING_SKILLS: readonly ElpSkill[] = [
  {
    id: 'market-data-scan', name: 'Market Data Scan', category: 'finance', risk: 'read',
    description: 'Fetch and validate current and historical prices, market regime, breadth, volatility and relative movement before market conclusions are formed.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['market data','quote','price','chart','candles','market regime','relative strength','movement'],
    examples: ['Scan AAPL and QQQ for the last month', 'Compare BTC and ETH price movement'],
    requires: ['COMPOSIO_SEARCH_FINANCE or a connected market-data provider'],
  },
  {
    id: 'catalyst-intelligence', name: 'Catalyst Intelligence', category: 'finance', risk: 'read',
    description: 'Find, date, deduplicate and verify market-moving news, earnings, macro events, filings and other catalysts with source traceability.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['news','catalyst','earnings','macro','filing','event risk','headline'],
    examples: ['What catalysts can move NVDA this week?', 'Find today’s material BTC catalysts'],
    requires: ['COMPOSIO_SEARCH_NEWS', 'Public source verification'],
  },
  {
    id: 'technical-market-analysis', name: 'Technical Market Analysis', category: 'finance', risk: 'read',
    description: 'Evaluate trend, momentum, support/resistance, volatility, relative strength and invalidation using verified price series rather than invented indicators.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['technical analysis','trend','momentum','support','resistance','RSI','MACD','moving average'],
    examples: ['Analyze SPY trend and invalidation', 'Compare momentum across these symbols'],
    requires: ['Verified price series; derived indicators must be calculated from data when not provided'],
  },
  {
    id: 'fundamental-market-analysis', name: 'Fundamental Market Analysis', category: 'finance', risk: 'read',
    description: 'Assess company quality, valuation drivers, earnings sensitivity, balance sheet, competitive position and fundamental catalysts.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['fundamental','valuation','revenue','earnings','balance sheet','margin','competitor'],
    examples: ['Compare fundamentals for MSFT and GOOGL', 'What fundamental risks matter for this thesis?'],
    requires: ['Verified public fundamentals or connected financial-data provider'],
  },
  {
    id: 'competitor-movement-analysis', name: 'Competitor & Movement Analysis', category: 'finance', risk: 'read',
    description: 'Compare an asset with competitors, peers, sector benchmarks and correlated instruments to identify divergence, leadership and regime changes.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['competitor','peer','movement','relative strength','sector','benchmark','divergence'],
    examples: ['Compare TSLA against EV peers', 'Find which semiconductor names are leading the move'],
    requires: ['Market data plus company/sector context'],
  },
  {
    id: 'strategy-hypothesis-lab', name: 'Strategy Hypothesis Lab', category: 'finance', risk: 'read',
    description: 'Convert observations into falsifiable trading hypotheses with entry conditions, evidence requirements, invalidation and stop conditions.',
    toolkits: [], keywords: ['strategy','hypothesis','setup','signal','entry','exit','invalidation'],
    examples: ['Turn this market view into testable setups', 'Define what would invalidate this thesis'],
    requires: ['Evidence-backed market context'],
  },
  {
    id: 'quant-backtest-design', name: 'Quant Backtest Design', category: 'finance', risk: 'read',
    description: 'Define reproducible backtests with benchmark, rules, features, transaction-cost assumptions, walk-forward validation and overfitting checks.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['backtest','quant','walk forward','benchmark','overfit','historical test'],
    examples: ['Design a backtest for this momentum rule', 'Test whether this catalyst pattern persists historically'],
    requires: ['Historical market data'],
  },
  {
    id: 'paper-trading-simulator', name: 'Paper Trading Simulator', category: 'finance', risk: 'read',
    description: 'Create hypothetical positions and simulated order plans, track paper P&L and evaluate execution assumptions without submitting live orders.',
    toolkits: [], keywords: ['paper trade','simulate trade','virtual portfolio','paper portfolio','hypothetical trade'],
    examples: ['Paper trade this setup with a 1% risk budget', 'Build a simulated portfolio from these ideas'],
    requires: ['No live brokerage execution', 'Verified reference prices when performance is evaluated'],
  },
  {
    id: 'trading-risk-governor', name: 'Trading Risk Governor', category: 'finance', risk: 'high',
    description: 'Challenge trading theses, cap concentration and risk assumptions, require explicit invalidation, and veto unsupported or unverifiable setups.',
    toolkits: [], keywords: ['risk','position size','drawdown','stop loss','risk budget','veto','concentration'],
    examples: ['Stress-test this portfolio', 'What is the maximum defensible paper position size?'],
    requires: ['Defined risk budget', 'Explicit invalidation', 'No autonomous real-money execution'],
  },
  {
    id: 'agentic-market-pipeline', name: 'Agentic Market Pipeline', category: 'automation', risk: 'read',
    description: 'Route one market objective through specialist agents, tools and data sources, expose the pipeline, reconcile disagreements and synthesize one evidence-aware result.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['agent pipeline','serious mode','trading mode','multiple agents','delegate research','agentic'],
    examples: ['Use the full agent team to analyze this opportunity', 'Build a research pipeline for this market objective'],
    requires: ['Hermes reasoning provider', 'At least one verified market-data source'],
  },
  {
    id: 'connector-router', name: 'Connector Router', category: 'automation', risk: 'read',
    description: 'Discover the best available data/tool connector for each subtask, prefer direct structured APIs, validate freshness, and fall back safely when a provider is unavailable.',
    toolkits: ['COMPOSIO_SEARCH'], keywords: ['connector','tool discovery','data source','API','route tools','connected'],
    examples: ['Find the best data connector for this analysis', 'Use a fallback if the primary market feed is unavailable'],
    requires: ['Connector inventory and provider health checks'],
  },
  {
    id: 'capability-gap-engineer', name: 'Capability Gap Engineer', category: 'developer', risk: 'write',
    description: 'Detect missing reusable capabilities during missions and produce a validated skill proposal with inputs, outputs, connectors, tests and safety boundaries before installation.',
    toolkits: ['GITHUB'], keywords: ['create skill','missing skill','capability gap','new agent','build capability'],
    examples: ['Create a reusable skill for this repeated analysis', 'Identify what capability the agent team is missing'],
    requires: ['Validation before installation', 'Code review/CI for executable capabilities'],
  },
] as const;

export function tradingSkillsToPrompt() {
  return HERMES_TRADING_SKILLS.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
}
