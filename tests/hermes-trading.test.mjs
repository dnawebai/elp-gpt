import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const trading=fs.readFileSync(new URL('../lib/hermes-trading.ts',import.meta.url),'utf8');
const skills=fs.readFileSync(new URL('../lib/trading-skills.ts',import.meta.url),'utf8');
const skillsRoute=fs.readFileSync(new URL('../app/api/skills/route.ts',import.meta.url),'utf8');
const skillRegistry=fs.readFileSync(new URL('../lib/skill-registry.ts',import.meta.url),'utf8');
const connectors=fs.readFileSync(new URL('../lib/market-connectors.ts',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../app/api/hermes-trading/route.ts',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../app/hermes-trading/page.tsx',import.meta.url),'utf8');

test('Hermes trading is research/backtest/paper only',()=>{assert.match(trading,/paper trading only/i);assert.match(trading,/Never submit a real order/i);assert.match(trading,/Risk Officer has veto authority/i);assert.match(page,/Live order transmission is disabled/i);});
test('market evidence uses Composio finance and news fallback',()=>{assert.match(trading,/COMPOSIO_SEARCH_FINANCE/);assert.match(trading,/COMPOSIO_SEARCH_NEWS/);assert.match(trading,/verified-tool-output/);});
test('video-derived capabilities include movement, connectors, swarm and skill engineering',()=>{for(const id of ['competitor-movement-analysis','agentic-market-pipeline','connector-router','capability-gap-engineer','quant-backtest-design','paper-trading-simulator'])assert.match(skills,new RegExp(id));});
test('video-derived skills are exposed through the ELP skills API without replacing core skills',()=>{assert.match(skillsRoute,/ALL_ELP_SKILLS/);assert.match(skillRegistry,/HERMES_TRADING_SKILLS/);assert.match(skillRegistry,/ELP_SKILLS/);});
test('connector router includes all selected providers',()=>{for(const provider of ['Alpaca','Massive','CoinMarketCap','Composio Search'])assert.match(connectors,new RegExp(provider));for(const key of ['ALPACA_API_KEY_ID','MASSIVE_API_KEY','COINMARKETCAP_API_KEY','COMPOSIO_API_KEY'])assert.match(connectors,new RegExp(key));});
test('Hermes trading API requires authenticated profile cookie',()=>{assert.match(route,/PROFILE_COOKIE/);assert.match(route,/verifyProfileToken/);assert.match(route,/Identity not established/);assert.match(route,/Cache-Control.*private, no-store/);});
