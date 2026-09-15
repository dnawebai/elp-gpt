import { isComposioConfigured } from '@/lib/composio';

export type MarketConnectorId = 'alpaca' | 'massive' | 'coinmarketcap' | 'composio';
export type MarketCapability =
  | 'equities-realtime' | 'equities-history' | 'options' | 'crypto-realtime' | 'crypto-history'
  | 'forex' | 'futures' | 'indices' | 'economy' | 'fundamentals' | 'news' | 'narratives'
  | 'derivatives-risk' | 'corporate-actions';

export type MarketConnectorStatus = {
  id: MarketConnectorId;
  name: string;
  role: string;
  capabilities: MarketCapability[];
  runtimeReady: boolean;
  runtimeRequirement: string;
  priority: number;
};

function has(...names:string[]) { return names.every((name) => Boolean(process.env[name]?.trim())); }

export function getMarketConnectorStatus():MarketConnectorStatus[] {
  return [
    {
      id:'alpaca', name:'Alpaca', priority:1,
      role:'Primary structured market feed for U.S. equities, options and crypto; ideal for snapshots, bars, quotes, trades and option-chain research.',
      capabilities:['equities-realtime','equities-history','options','crypto-realtime','crypto-history','corporate-actions'],
      runtimeReady:has('ALPACA_API_KEY_ID','ALPACA_API_SECRET_KEY'),
      runtimeRequirement:'ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY in the deployed ELP runtime',
    },
    {
      id:'massive', name:'Massive', priority:2,
      role:'Deep cross-asset and institutional-grade feed for stocks, options, forex, futures, indices, ETFs and economic data.',
      capabilities:['equities-realtime','equities-history','options','crypto-realtime','forex','futures','indices','economy'],
      runtimeReady:has('MASSIVE_API_KEY'),
      runtimeRequirement:'MASSIVE_API_KEY in the deployed ELP runtime',
    },
    {
      id:'coinmarketcap', name:'CoinMarketCap', priority:2,
      role:'Crypto market-regime specialist for global metrics, narratives, leverage/derivatives, technical context and macro-event awareness.',
      capabilities:['crypto-realtime','narratives','derivatives-risk','economy'],
      runtimeReady:has('COINMARKETCAP_API_KEY'),
      runtimeRequirement:'COINMARKETCAP_API_KEY in the deployed ELP runtime',
    },
    {
      id:'composio', name:'Composio Search', priority:3,
      role:'Connector discovery, current finance/news search, public-web verification and fallback/cross-check source.',
      capabilities:['equities-realtime','fundamentals','news','economy'],
      runtimeReady:isComposioConfigured(),
      runtimeRequirement:'COMPOSIO_API_KEY and allowed COMPOSIO_SEARCH tools',
    },
  ];
}

export function chooseMarketConnectors(capabilities:MarketCapability[]) {
  const statuses=getMarketConnectorStatus();
  return statuses
    .map((connector)=>({connector,coverage:capabilities.filter((cap)=>connector.capabilities.includes(cap)).length}))
    .filter((entry)=>entry.coverage>0)
    .sort((a,b)=>Number(b.connector.runtimeReady)-Number(a.connector.runtimeReady) || b.coverage-a.coverage || a.connector.priority-b.connector.priority)
    .map((entry)=>entry.connector);
}

export function marketConnectorPrompt() {
  return getMarketConnectorStatus().map((connector)=>`- ${connector.name}: ${connector.role} Runtime ${connector.runtimeReady?'READY':'NOT CONFIGURED'}.`).join('\n');
}
