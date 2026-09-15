import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const trading=fs.readFileSync(new URL('../lib/hermes-trading.ts',import.meta.url),'utf8');
const skills=fs.readFileSync(new URL('../lib/trading-skills.ts',import.meta.url),'utf8');
const registry=fs.readFileSync(new URL('../lib/skills.ts',import.meta.url),'utf8');
const route=fs.readFileSync(new URL('../app/api/hermes-trading/route.ts',import.meta.url),'utf8');

test('Hermes trading is research/backtest/paper only',()=>{assert.match(trading,/paper trading only/i);assert.match(trading,/Never submit a real order/i);assert.match(trading,/Risk Officer has veto authority/i);});
test('market evidence uses Composio finance and news',()=>{assert.match(trading,/COMPOSIO_SEARCH_FINANCE/);assert.match(trading,/COMPOSIO_SEARCH_NEWS/);assert.match(trading,/verified-tool-output/);});
test('video-derived capabilities include movement, connectors, swarm and skill engineering',()=>{for(const id of ['competitor-movement-analysis','agentic-market-pipeline','connector-router','capability-gap-engineer','quant-backtest-design','paper-trading-simulator'])assert.match(skills,new RegExp(id));});
test('video-derived skills are exposed in global ELP registry',()=>{assert.match(registry,/HERMES_TRADING_SKILLS/);assert.match(registry,/\.\.\.HERMES_TRADING_SKILLS/);});
test('Hermes trading API requires authenticated profile cookie',()=>{assert.match(route,/PROFILE_COOKIE/);assert.match(route,/verifyProfileToken/);assert.match(route,/Identity not established/);assert.match(route,/Cache-Control.*private, no-store/);});
