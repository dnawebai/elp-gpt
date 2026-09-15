import { NextResponse } from 'next/server';
import { ELP_SKILLS, matchSkills } from '@/lib/skills';
import { HERMES_TRADING_SKILLS } from '@/lib/trading-skills';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@.+-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchTradingSkills(query: string, limit = 12) {
  const q = normalize(query);
  if (!q) return HERMES_TRADING_SKILLS;
  const tokens = new Set(q.split(' ').filter((token) => token.length > 1));
  return HERMES_TRADING_SKILLS
    .map((skill) => {
      let score = q.includes(normalize(skill.id)) ? 10 : 0;
      if (q.includes(normalize(skill.name))) score += 8;
      for (const keyword of skill.keywords) if (q.includes(normalize(keyword))) score += 5;
      for (const token of tokens) {
        if (normalize(skill.name).includes(token)) score += 2;
        if (normalize(skill.description).includes(token)) score += 1;
      }
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.skill);
}

export async function GET(request: Request) {
  if (!profileFrom(request)) {
    return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  const core = query ? matchSkills(query, 12) : [...ELP_SKILLS];
  const trading = query ? matchTradingSkills(query, 12) : [...HERMES_TRADING_SKILLS];
  const skills = [...core, ...trading].filter((skill, index, all) => all.findIndex((candidate) => candidate.id === skill.id) === index);

  return NextResponse.json(
    {
      count: skills.length,
      total: ELP_SKILLS.length + HERMES_TRADING_SKILLS.length,
      query: query || null,
      skills,
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
