export type LukeSkillRisk = 'read' | 'write' | 'high';

export type LukeSkill = {
  id: string;
  name: string;
  category:
    | 'intelligence'
    | 'communication'
    | 'calendar'
    | 'concierge'
    | 'travel'
    | 'commerce'
    | 'files'
    | 'developer'
    | 'automation'
    | 'device'
    | 'home'
    | 'finance'
    | 'social';
  description: string;
  risk: LukeSkillRisk;
  toolkits: string[];
  keywords: string[];
  examples: string[];
  requires: string[];
};

export const LUKE_SKILLS: readonly LukeSkill[] = [
  {
    id: 'web-research',
    name: 'Web Research',
    category: 'intelligence',
    description: 'Search the public web, compare sources, verify claims, and synthesize current information.',
    risk: 'read',
    toolkits: ['COMPOSIO_SEARCH'],
    keywords: ['search web', 'research', 'look up', 'find online', 'latest', 'verify', 'fact check'],
    examples: ['Research this company', 'Find the latest information about this topic'],
    requires: ['Composio Search'],
  },
  {
    id: 'local-concierge',
    name: 'Local Concierge',
    category: 'concierge',
    description: 'Find nearby restaurants, hotels, stores, venues, salons, contractors, and services using current location when authorized.',
    risk: 'read',
    toolkits: ['COMPOSIO_SEARCH', 'YELP'],
    keywords: ['near me', 'nearby', 'restaurant', 'hotel', 'store', 'salon', 'plumber', 'electrician', 'mechanic', 'venue', 'local service'],
    examples: ['Find a plumber near me', 'Find a highly rated restaurant nearby'],
    requires: ['Browser location permission for near-me requests', 'Composio Search or Yelp'],
  },
  {
    id: 'email-triage',
    name: 'Email Triage',
    category: 'communication',
    description: 'Search, read, summarize, prioritize, and extract actions from email.',
    risk: 'read',
    toolkits: ['GMAIL'],
    keywords: ['email', 'inbox', 'gmail', 'unread', 'mail', 'important messages', 'summarize email'],
    examples: ['What emails need my attention?', 'Find the email from Jean'],
    requires: ['Connected Gmail account'],
  },
  {
    id: 'email-action',
    name: 'Email Action',
    category: 'communication',
    description: 'Create drafts, reply, forward, send, archive, and organize email after the applicable approval step.',
    risk: 'write',
    toolkits: ['GMAIL'],
    keywords: ['reply email', 'send email', 'draft email', 'forward email', 'archive email', 'email them'],
    examples: ['Reply that Thursday works', 'Draft an email and send it after I approve'],
    requires: ['Connected Gmail account'],
  },
  {
    id: 'calendar-read',
    name: 'Calendar Intelligence',
    category: 'calendar',
    description: 'Read schedules, find events, inspect availability, and identify conflicts.',
    risk: 'read',
    toolkits: ['GOOGLECALENDAR'],
    keywords: ['calendar', 'schedule', 'availability', 'free time', 'meeting today', 'appointments', 'conflict'],
    examples: ['What is on my calendar today?', 'When am I free tomorrow?'],
    requires: ['Connected calendar account'],
  },
  {
    id: 'calendar-action',
    name: 'Calendar Action',
    category: 'calendar',
    description: 'Create, reschedule, update, RSVP to, or cancel calendar events with approval for external changes.',
    risk: 'write',
    toolkits: ['GOOGLECALENDAR'],
    keywords: ['book meeting', 'create event', 'reschedule', 'move meeting', 'cancel meeting', 'invite', 'appointment'],
    examples: ['Book a meeting Thursday at 2', 'Move my appointment to Friday'],
    requires: ['Connected calendar account'],
  },
  {
    id: 'travel-research',
    name: 'Travel Research',
    category: 'travel',
    description: 'Research flights, hotels, transportation, destinations, itineraries, and travel constraints.',
    risk: 'read',
    toolkits: ['COMPOSIO_SEARCH'],
    keywords: ['flight', 'hotel', 'trip', 'travel', 'airport', 'rental car', 'itinerary', 'train'],
    examples: ['Find the best flight to Milan', 'Compare hotels near my meeting'],
    requires: ['Composio Search and/or connected travel provider'],
  },
  {
    id: 'booking-concierge',
    name: 'Booking Concierge',
    category: 'concierge',
    description: 'Coordinate a reservation or service appointment through an API, browser workflow, email, or phone call.',
    risk: 'high',
    toolkits: [],
    keywords: ['book it', 'reserve', 'reservation', 'make appointment', 'confirm booking', 'hire', 'schedule service'],
    examples: ['Reserve the best option', 'Book the electrician for this afternoon'],
    requires: ['Appropriate provider connection', 'Explicit approval before commitment'],
  },
  {
    id: 'shopping-research',
    name: 'Shopping Research',
    category: 'commerce',
    description: 'Find products, compare prices, reviews, specifications, merchants, and availability.',
    risk: 'read',
    toolkits: ['COMPOSIO_SEARCH'],
    keywords: ['buy', 'shopping', 'price', 'compare products', 'in stock', 'best product', 'store inventory'],
    examples: ['Find the best laptop for this budget', 'Compare local availability'],
    requires: ['Composio Search and/or commerce connection'],
  },
  {
    id: 'purchase-action',
    name: 'Purchase Action',
    category: 'commerce',
    description: 'Prepare and execute a purchase only through an approved commerce/payment integration and explicit authorization.',
    risk: 'high',
    toolkits: [],
    keywords: ['purchase', 'checkout', 'pay for', 'order it', 'place order'],
    examples: ['Buy this after I approve the total', 'Place the order using my authorized payment method'],
    requires: ['Approved commerce/payment provider', 'Explicit approval and spending policy'],
  },
  {
    id: 'outbound-calling',
    name: 'Outbound Calling',
    category: 'communication',
    description: 'Place an AI-assisted outbound phone call to a business or service, gather information, and report the verified outcome.',
    risk: 'write',
    toolkits: ['RETELLAI', 'VAPI'],
    keywords: ['call', 'phone', 'ring', 'speak to', 'call the store', 'call restaurant', 'call hotel'],
    examples: ['Call the hotel and ask about availability', 'Call the plumber and get a quote'],
    requires: ['Connected Retell AI or Vapi account', 'Provisioned/authorized phone number'],
  },
  {
    id: 'contacts',
    name: 'Contacts & People',
    category: 'communication',
    description: 'Find authorized contact details and use relationship context to support communications and scheduling.',
    risk: 'read',
    toolkits: ['GMAIL'],
    keywords: ['contact', 'phone number', 'email address', 'person', 'who is', 'find contact'],
    examples: ['Find Jean in my contacts', 'What email address do I have for this person?'],
    requires: ['Connected contacts-capable account'],
  },
  {
    id: 'drive-files',
    name: 'Drive & Files',
    category: 'files',
    description: 'Find, read, summarize, organize, create, and share authorized cloud files with approval for mutations.',
    risk: 'write',
    toolkits: ['GOOGLEDRIVE'],
    keywords: ['drive', 'file', 'document', 'spreadsheet', 'slides', 'folder', 'share file'],
    examples: ['Find the proposal in Drive', 'Share the final report after I approve'],
    requires: ['Connected file-storage account'],
  },
  {
    id: 'meeting-assistant',
    name: 'Meeting Assistant',
    category: 'calendar',
    description: 'Prepare meeting context, agendas, relevant email/file history, action items, and follow-ups.',
    risk: 'read',
    toolkits: ['GOOGLECALENDAR', 'GMAIL', 'GOOGLEDRIVE'],
    keywords: ['meeting prep', 'prepare meeting', 'agenda', 'meeting notes', 'follow up meeting', 'brief me'],
    examples: ['Brief me for my next meeting', 'Prepare an agenda from the recent thread'],
    requires: ['Calendar and optional email/file connections'],
  },
  {
    id: 'daily-briefing',
    name: 'Executive Briefing',
    category: 'automation',
    description: 'Combine calendar, communications, tasks, current information, and open commitments into a concise briefing.',
    risk: 'read',
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'COMPOSIO_SEARCH'],
    keywords: ['briefing', 'morning brief', 'daily brief', 'what needs attention', 'priorities today', 'executive summary'],
    examples: ['Give me my morning briefing', 'What needs my attention today?'],
    requires: ['One or more connected information sources'],
  },
  {
    id: 'monitoring',
    name: 'Monitoring & Signals',
    category: 'automation',
    description: 'Watch an authorized source or condition and surface meaningful changes through an external scheduler/webhook system.',
    risk: 'read',
    toolkits: [],
    keywords: ['monitor', 'watch', 'alert me', 'when it changes', 'track', 'notify', 'price drop', 'flight changes'],
    examples: ['Watch this flight for changes', 'Alert me when a reservation becomes available'],
    requires: ['Scheduler/webhook runtime for persistent monitoring'],
  },
  {
    id: 'github-developer',
    name: 'GitHub Developer',
    category: 'developer',
    description: 'Inspect repositories, issues, pull requests, code, CI, and prepare or apply authorized engineering changes.',
    risk: 'write',
    toolkits: ['GITHUB'],
    keywords: ['github', 'repository', 'repo', 'pull request', 'issue', 'commit', 'code', 'deploy'],
    examples: ['Inspect the failing pull request', 'Create a branch and fix the issue'],
    requires: ['Connected GitHub account'],
  },
  {
    id: 'browser-operator',
    name: 'Browser Operator',
    category: 'intelligence',
    description: 'Use an authorized browser/computer agent as a fallback when a safe direct API or connector is unavailable.',
    risk: 'high',
    toolkits: [],
    keywords: ['use browser', 'click', 'fill form', 'website login', 'computer use', 'browser automation'],
    examples: ['Complete this web form', 'Use the website because there is no API'],
    requires: ['Browser/computer-use provider', 'Explicit approval for consequential actions'],
  },
  {
    id: 'device-context',
    name: 'Device Context',
    category: 'device',
    description: 'Read browser-provided time, timezone, locale, connectivity, and user-authorized current coordinates.',
    risk: 'read',
    toolkits: [],
    keywords: ['where am i', 'my location', 'current location', 'timezone', 'local time', 'device'],
    examples: ['Use my current location', 'What timezone am I in?'],
    requires: ['Browser permission for precise location'],
  },
  {
    id: 'messaging',
    name: 'Messaging',
    category: 'communication',
    description: 'Read and send messages through connected communication services using per-service permissions.',
    risk: 'write',
    toolkits: [],
    keywords: ['slack', 'teams', 'whatsapp', 'sms', 'message', 'dm', 'text them'],
    examples: ['Send this on Slack', 'Message the team after I approve'],
    requires: ['Connected messaging provider'],
  },
  {
    id: 'smart-home',
    name: 'Smart Home',
    category: 'home',
    description: 'Control explicitly exposed home devices, scenes, climate, lighting, and compatible automations.',
    risk: 'high',
    toolkits: [],
    keywords: ['lights', 'thermostat', 'home assistant', 'smart home', 'alarm', 'garage', 'climate'],
    examples: ['Set the house for movie night', 'Turn off the downstairs lights'],
    requires: ['Home Assistant or another approved IoT connector', 'Device allowlist'],
  },
  {
    id: 'finance-insights',
    name: 'Finance Insights',
    category: 'finance',
    description: 'Read authorized balances, transactions, bills, subscriptions, and budgets to provide analysis without moving money.',
    risk: 'read',
    toolkits: [],
    keywords: ['transactions', 'balance', 'budget', 'subscriptions', 'bills', 'spending', 'finance'],
    examples: ['Find recurring subscriptions', 'Summarize my spending'],
    requires: ['Read-only financial connection'],
  },
  {
    id: 'finance-action',
    name: 'Finance Action',
    category: 'finance',
    description: 'Prepare financial changes only through an approved provider with explicit transaction authorization and limits.',
    risk: 'high',
    toolkits: [],
    keywords: ['transfer money', 'pay bill', 'financial transaction', 'send money', 'cancel subscription'],
    examples: ['Prepare this bill payment for approval', 'Cancel the subscription after I confirm'],
    requires: ['Approved financial provider', 'Explicit approval and transaction limits'],
  },
  {
    id: 'social-media',
    name: 'Social Media',
    category: 'social',
    description: 'Analyze connected social accounts and prepare or publish content under explicit account permissions.',
    risk: 'write',
    toolkits: [],
    keywords: ['instagram', 'linkedin', 'tiktok', 'facebook', 'social media', 'post', 'publish'],
    examples: ['Analyze my recent posts', 'Publish the approved post'],
    requires: ['Connected social account'],
  },
] as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@.+-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchSkills(query: string, limit = 6): LukeSkill[] {
  const q = normalize(query);
  if (!q) return LUKE_SKILLS.slice(0, Math.max(1, Math.min(limit, 24)));
  const tokens = new Set(q.split(' ').filter((token) => token.length > 1));

  return LUKE_SKILLS
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
    .slice(0, Math.max(1, Math.min(limit, 24)))
    .map((entry) => entry.skill);
}

export function getSkill(id: string) {
  const normalized = normalize(id).replaceAll(' ', '-');
  return LUKE_SKILLS.find((skill) => skill.id === normalized) || null;
}

export function skillsToPrompt() {
  return LUKE_SKILLS.map((skill) => {
    const toolkits = skill.toolkits.length ? ` Preferred toolkits: ${skill.toolkits.join(', ')}.` : '';
    return `- ${skill.id} [${skill.risk}]: ${skill.description}${toolkits}`;
  }).join('\n');
}
