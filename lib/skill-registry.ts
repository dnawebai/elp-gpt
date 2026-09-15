import { ELP_SKILLS, type ElpSkill } from '@/lib/skills';
import { HERMES_TRADING_SKILLS } from '@/lib/trading-skills';
import { HERMES_CREATIVE_SKILLS } from '@/lib/creative-skills';
import { AGENT_PLATFORM_SKILLS } from '@/lib/agent-platform-skills';

export const ALL_ELP_SKILLS: readonly ElpSkill[] = [
  ...ELP_SKILLS,
  ...HERMES_TRADING_SKILLS,
  ...HERMES_CREATIVE_SKILLS,
  ...AGENT_PLATFORM_SKILLS,
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@.+-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchAllSkills(query: string, limit = 12): ElpSkill[] {
  const q = normalize(query);
  if (!q) return ALL_ELP_SKILLS.slice(0, Math.max(1, Math.min(limit, ALL_ELP_SKILLS.length)));
  const tokens = new Set(q.split(' ').filter((token) => token.length > 1));
  return ALL_ELP_SKILLS
    .map((skill) => {
      let score = 0;
      const name = normalize(skill.name);
      const description = normalize(skill.description);
      if (q.includes(normalize(skill.id))) score += 10;
      if (q.includes(name)) score += 8;
      for (const keyword of skill.keywords) {
        const key = normalize(keyword);
        if (key && q.includes(key)) score += key.includes(' ') ? 6 : 4;
      }
      for (const token of tokens) {
        if (name.includes(token)) score += 2;
        if (description.includes(token)) score += 1;
      }
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, Math.max(1, Math.min(limit, ALL_ELP_SKILLS.length)))
    .map((entry) => entry.skill);
}

export function allSkillsToPrompt() {
  return ALL_ELP_SKILLS.map((skill) => `- ${skill.name} [${skill.risk}]: ${skill.description}`).join('\n');
}
