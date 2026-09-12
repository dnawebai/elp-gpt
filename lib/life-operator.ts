export type LifeOperatorAudience = 'employee' | 'manager' | 'founder' | 'ceo' | 'principal';
export type LifeOperatorChannel = 'ai' | 'connector' | 'browser' | 'voice' | 'human' | 'professional';
export type LifeOperatorAutonomy = 0 | 1 | 2 | 3 | 4 | 5;

export type LifeOperatorDomain = {
  id: string;
  name: string;
  mission: string;
  audiences: LifeOperatorAudience[];
  channels: LifeOperatorChannel[];
  toolkits: string[];
  futureIntegrations: string[];
  maxAutonomy: LifeOperatorAutonomy;
  approvalRule: string;
  professionalBoundary?: string;
  tasks: string[];
  examples: string[];
};

export const LIFE_OPERATOR_DOMAINS: readonly LifeOperatorDomain[] = [
  {
    id: 'day-command',
    name: 'Day Command',
    mission: 'Continuously compress the user’s day into the smallest set of decisions and personal actions while delegating everything else.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'voice'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'GOOGLEDRIVE', 'COMPOSIO_SEARCH'],
    futureIntegrations: ['task manager', 'weather', 'traffic', 'travel status'],
    maxAutonomy: 3,
    approvalRule: 'Read, summarize, prioritize, and prepare automatically. External changes follow the action approval policy.',
    tasks: [
      'Generate a morning briefing', 'Identify the top three priorities', 'Detect calendar conflicts', 'Surface urgent email',
      'Find promises and overdue commitments', 'Identify bills and deadlines', 'Detect travel disruption', 'Prepare meeting briefs',
      'Recommend meetings to cancel or delegate', 'Calculate travel time between commitments', 'Protect focus time',
      'Generate an end-of-day review', 'Build tomorrow’s preparation list', 'Maintain a waiting-for list',
    ],
    examples: ['Handle my day', 'What actually needs me today?', 'Prepare me for tomorrow'],
  },
  {
    id: 'communications',
    name: 'Communications Office',
    mission: 'Own the flow of email and workplace messages so the user only sees communications that require judgment, trust, or authority.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'voice'],
    toolkits: ['GMAIL', 'SLACK', 'MICROSOFT_TEAMS'],
    futureIntegrations: ['Outlook', 'WhatsApp Business', 'SMS'],
    maxAutonomy: 4,
    approvalRule: 'Reads and drafts may be automatic. Sending, forwarding, archiving, labeling, or messaging obey per-action permissions.',
    tasks: [
      'Triage inbox', 'Prioritize VIP messages', 'Summarize long threads', 'Extract questions and commitments', 'Draft replies',
      'Reply to routine messages', 'Request missing information', 'Chase unanswered messages', 'Archive completed threads',
      'Apply labels', 'Detect invoices and receipts', 'Detect contracts', 'Detect phishing indicators', 'Summarize team chat',
      'Send approved Slack or Teams messages', 'Maintain communication follow-up queue',
    ],
    examples: ['Handle my inbox', 'Who is waiting for me?', 'Draft everything I need to answer today'],
  },
  {
    id: 'calendar',
    name: 'Calendar & Time',
    mission: 'Protect the user’s time and turn scheduling into a delegated negotiation problem.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector'],
    toolkits: ['GOOGLECALENDAR'],
    futureIntegrations: ['Outlook Calendar', 'Calendly'],
    maxAutonomy: 4,
    approvalRule: 'Availability and conflict checks may run automatically. Changes affecting other people require the configured approval level.',
    tasks: [
      'Read agenda', 'Find free time', 'Book meetings', 'Reschedule meetings', 'Cancel meetings', 'Negotiate meeting times',
      'Protect focus blocks', 'Insert travel buffers', 'Handle time zones', 'Avoid back-to-back meetings', 'RSVP to invitations',
      'Create recurring events', 'Reserve family time', 'Add preparation time', 'Detect low-value meeting load',
    ],
    examples: ['Find a time with them', 'Rebuild my afternoon', 'Protect two hours for deep work'],
  },
  {
    id: 'meetings',
    name: 'Meeting Intelligence',
    mission: 'Make every meeting start with context and end with decisions, owners, and tracked follow-through.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'voice'],
    toolkits: ['GOOGLECALENDAR', 'GMAIL', 'GOOGLEDRIVE'],
    futureIntegrations: ['Zoom', 'Google Meet transcripts', 'Microsoft Teams transcripts'],
    maxAutonomy: 3,
    approvalRule: 'Preparation and extraction are automatic. Outbound follow-ups or assignments use the communication approval policy.',
    tasks: [
      'Research participants', 'Create participant dossiers', 'Recover prior correspondence', 'Find related files', 'Prepare agenda',
      'Generate talking points', 'Capture transcript', 'Summarize meeting', 'Extract decisions', 'Extract action items',
      'Assign owners', 'Draft follow-ups', 'Schedule next meeting', 'Track unfinished actions',
    ],
    examples: ['Brief me for my next meeting', 'What did we promise?', 'Turn this meeting into actions'],
  },
  {
    id: 'delegation',
    name: 'Delegation & Task Control',
    mission: 'Convert every commitment into the correct execution path: user, AI, employee, vendor, or licensed professional.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'human', 'professional'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'SLACK', 'MICROSOFT_TEAMS'],
    futureIntegrations: ['Asana', 'Linear', 'ClickUp', 'Todoist', 'Monday'],
    maxAutonomy: 4,
    approvalRule: 'Internal low-risk delegation can be pre-authorized. Financial, legal, public, or irreversible commitments require stronger approval.',
    tasks: [
      'Capture tasks from voice', 'Extract tasks from email', 'Extract tasks from meetings', 'Prioritize work', 'Estimate urgency',
      'Break projects into steps', 'Assign AI tasks', 'Assign employee tasks', 'Assign vendor tasks', 'Track deadlines',
      'Chase owners', 'Escalate blockers', 'Maintain delegated queue', 'Verify completion evidence',
    ],
    examples: ['Delegate everything that does not need me', 'Who owns the open actions?', 'Chase the overdue work'],
  },
  {
    id: 'research-decisions',
    name: 'Research & Decision Intelligence',
    mission: 'Turn ambiguous questions into evidence, options, risk analysis, and a decision-ready recommendation.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser'],
    toolkits: ['COMPOSIO_SEARCH', 'YELP', 'GOOGLEDRIVE'],
    futureIntegrations: ['specialist data providers', 'company databases'],
    maxAutonomy: 2,
    approvalRule: 'Research and recommendations are automatic. Material decisions remain with the user unless an explicit policy delegates them.',
    tasks: [
      'Research people', 'Research companies', 'Research competitors', 'Compare products', 'Compare vendors', 'Compare properties',
      'Verify claims', 'Find alternatives', 'Calculate ROI', 'Run scenarios', 'Identify risks', 'Challenge assumptions',
      'Create pros and cons', 'Build decision memo', 'Remember decision rationale',
    ],
    examples: ['Should I do this?', 'Give me the decision, not twenty links', 'Compare the best three options'],
  },
  {
    id: 'travel',
    name: 'Travel Office',
    mission: 'Plan, coordinate, monitor, and recover travel with minimal user involvement.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser', 'voice', 'human'],
    toolkits: ['COMPOSIO_SEARCH', 'GMAIL', 'GOOGLECALENDAR', 'BROWSER_TOOL'],
    futureIntegrations: ['airline APIs', 'hotel APIs', 'rail APIs', 'ground transport'],
    maxAutonomy: 4,
    approvalRule: 'Search and itinerary construction are automatic. Paid bookings, cancellations, upgrades, or rebooking follow spending and travel policies.',
    tasks: [
      'Search flights', 'Compare routes', 'Optimize timing', 'Research points options', 'Research hotels', 'Arrange ground transport',
      'Build itinerary', 'Check visa requirements', 'Prepare travel document checklist', 'Find restaurants and activities',
      'Monitor flight changes', 'Calculate airport departure time', 'Request early check-in', 'Request late checkout',
      'Create packing list', 'Handle disruption recovery',
    ],
    examples: ['I am going to Milan Monday', 'Fix my trip', 'Handle the entire itinerary'],
  },
  {
    id: 'concierge',
    name: 'Lifestyle Concierge',
    mission: 'Find access, availability, reservations, experiences, and services matching the user’s preferences.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser', 'voice', 'human'],
    toolkits: ['COMPOSIO_SEARCH', 'YELP', 'BROWSER_TOOL'],
    futureIntegrations: ['OpenTable', 'Resy', 'Ticketmaster', 'golf booking', 'spa providers', 'luxury concierge partners'],
    maxAutonomy: 4,
    approvalRule: 'Discovery is automatic. Reservations with penalties, deposits, memberships, or purchases require the configured commitment approval.',
    tasks: [
      'Find restaurants', 'Find hard-to-get reservations', 'Find hotels', 'Find events', 'Find concerts', 'Find sports tickets',
      'Find theater', 'Find spas', 'Find golf', 'Find nightlife', 'Find private tours', 'Find local experiences',
      'Coordinate reservations', 'Coordinate guests', 'Arrange transport', 'Source gifts',
    ],
    examples: ['Get us dinner for eight tomorrow', 'Plan Saturday night', 'Find something exceptional near me'],
  },
  {
    id: 'shopping-errands',
    name: 'Shopping & Errands',
    mission: 'Move routine purchasing and physical errands from the user into governed digital and real-world execution.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser', 'human'],
    toolkits: ['COMPOSIO_SEARCH', 'BROWSER_TOOL'],
    futureIntegrations: ['Instacart', 'Uber Direct', 'DoorDash Drive', 'Taskrabbit', 'retail APIs'],
    maxAutonomy: 4,
    approvalRule: 'Research and cart preparation may be automatic. Purchases obey budget thresholds; physical dispatch requires approved vendors and destination rules.',
    tasks: [
      'Find products', 'Compare prices', 'Check availability', 'Build carts', 'Track deliveries', 'Handle returns', 'Handle exchanges',
      'Track warranties', 'Reorder household staples', 'Arrange grocery delivery', 'Arrange courier pickup', 'Arrange package drop-off',
      'Arrange dry cleaning pickup', 'Arrange local errands', 'Dispatch delivery services',
    ],
    examples: ['Order the usual groceries', 'Return this package', 'Get this document across town today'],
  },
  {
    id: 'household-property',
    name: 'Household & Property',
    mission: 'Operate homes and properties as managed systems with schedules, inventories, vendors, maintenance, and arrival readiness.',
    audiences: ['principal', 'ceo', 'founder', 'manager', 'employee'],
    channels: ['ai', 'connector', 'human'],
    toolkits: ['COMPOSIO_SEARCH', 'YELP', 'GMAIL', 'GOOGLECALENDAR'],
    futureIntegrations: ['Home Assistant', 'property management systems', 'Taskrabbit'],
    maxAutonomy: 4,
    approvalRule: 'Routine recurring service inside budget may be pre-authorized. New vendors, expensive repairs, security changes, or property access require stronger approval.',
    tasks: [
      'Schedule cleaning', 'Schedule gardening', 'Schedule pool service', 'Schedule HVAC maintenance', 'Find plumbers', 'Find electricians',
      'Find contractors', 'Request quotes', 'Compare quotes', 'Coordinate access', 'Track repair completion', 'Maintain home inventory',
      'Track warranties', 'Track appliance serial numbers', 'Manage utilities calendar', 'Prepare property before arrival',
      'Manage pantry and household supplies', 'Coordinate laundry and linens',
    ],
    examples: ['Run the house this week', 'Get three quotes and book the best plumber after approval', 'Prepare the property before we arrive'],
  },
  {
    id: 'family-education',
    name: 'Family & Education',
    mission: 'Coordinate family logistics, school obligations, activities, dates, and shared planning.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'human'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'GOOGLEDRIVE'],
    futureIntegrations: ['school portals', 'family calendars', 'childcare providers'],
    maxAutonomy: 3,
    approvalRule: 'Organization and reminders are automatic. Enrollments, payments, permissions, and child-related commitments require guardian approval.',
    tasks: [
      'Maintain shared family calendar', 'Track school dates', 'Track permission forms', 'Coordinate pickups', 'Coordinate childcare',
      'Register activities', 'Track camps', 'Track tuition deadlines', 'Schedule parent-teacher meetings', 'Research tutors',
      'Track birthdays', 'Plan family trips', 'Maintain emergency contacts', 'Organize school documents',
    ],
    examples: ['What does the family need this week?', 'Handle the school calendar', 'Find the conflicts between work and family'],
  },
  {
    id: 'health-admin',
    name: 'Health Administration',
    mission: 'Reduce health logistics and paperwork without replacing clinicians or making autonomous medical decisions.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'professional'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'GOOGLEDRIVE'],
    futureIntegrations: ['health record connector', 'insurance portals', 'pharmacy services'],
    maxAutonomy: 2,
    approvalRule: 'Administrative organization is allowed. Diagnosis, prescribing, treatment decisions, or emergency triage remain with qualified professionals and the user.',
    professionalBoundary: 'No autonomous diagnosis, prescribing, or replacement of licensed medical care.',
    tasks: [
      'Track appointments', 'Organize records', 'Prepare appointment questions', 'Track medication refill reminders', 'Organize test results',
      'Find providers', 'Coordinate appointment scheduling', 'Prepare insurance paperwork', 'Maintain health document folder',
      'Summarize fitness and activity data when connected', 'Maintain family health calendar',
    ],
    examples: ['Prepare me for my doctor appointment', 'Organize these medical documents', 'Find a provider and available appointments'],
  },
  {
    id: 'finance-admin',
    name: 'Financial Administration',
    mission: 'Make spending, subscriptions, bills, statements, and cash-flow obligations visible and organized while separating analysis from money movement.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'professional'],
    toolkits: [],
    futureIntegrations: ['Plaid', 'accounting software', 'expense platforms', 'payment providers'],
    maxAutonomy: 2,
    approvalRule: 'Read-only analysis may be automated. Transfers, payments, investments, credit actions, and account changes require transaction-specific authorization.',
    professionalBoundary: 'Regulated financial advice and tax advice remain with licensed/qualified professionals where applicable.',
    tasks: [
      'Categorize spending', 'Detect recurring subscriptions', 'Detect price increases', 'Build monthly budget', 'Track bills',
      'Track statements', 'Organize receipts', 'Prepare expense reports', 'Detect duplicate charges', 'Prepare accountant packet',
      'Maintain financial calendar', 'Build cash-flow dashboard', 'Prepare payment for approval', 'Track reimbursements',
    ],
    examples: ['Where is my money going?', 'Find subscriptions I should cancel', 'Prepare everything for my accountant'],
  },
  {
    id: 'relationships-events',
    name: 'Relationships, Gifts & Events',
    mission: 'Maintain relationship context and proactively manage important dates, follow-ups, hospitality, and events.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'human'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'COMPOSIO_SEARCH'],
    futureIntegrations: ['CRM', 'contacts provider', 'gift providers', 'event vendors'],
    maxAutonomy: 3,
    approvalRule: 'Reminders and preparation are automatic. Messages, gifts, invitations, and purchases follow communication and spending approval rules.',
    tasks: [
      'Track birthdays', 'Track anniversaries', 'Track relationship history', 'Remember interests', 'Remember family details shared for this purpose',
      'Suggest follow-ups', 'Draft introductions', 'Source gifts', 'Coordinate gift delivery', 'Plan dinners', 'Plan celebrations',
      'Manage invitations', 'Track RSVPs', 'Coordinate catering', 'Coordinate transport', 'Prepare seating plan',
    ],
    examples: ['Who have I neglected?', 'Handle the birthday gifts this month', 'Plan the client dinner'],
  },
  {
    id: 'executive-office',
    name: 'Executive Office & Chief of Staff',
    mission: 'Protect executive attention, maintain the decision queue, and keep strategy translated into accountable execution.',
    audiences: ['manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'professional'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'GOOGLEDRIVE', 'SLACK', 'MICROSOFT_TEAMS'],
    futureIntegrations: ['CRM', 'BI dashboards', 'project management', 'board portal'],
    maxAutonomy: 4,
    approvalRule: 'Internal synthesis and tracking can be proactive. External commitments, board communications, public statements, and material company actions require authority checks.',
    tasks: [
      'Maintain CEO priorities', 'Build weekly operating plan', 'Track strategic initiatives', 'Identify blockers', 'Maintain decision queue',
      'Prepare decision briefs', 'Coordinate executives', 'Track executive commitments', 'Monitor KPIs', 'Prepare leadership meetings',
      'Audit calendar against priorities', 'Prepare board packs', 'Track board actions', 'Prepare investor meetings', 'Maintain key relationship map',
      'Identify matters that truly require the executive',
    ],
    examples: ['Act as my chief of staff', 'What needs the CEO?', 'Prepare the leadership meeting'],
  },
  {
    id: 'company-operations',
    name: 'Company Operations',
    mission: 'Provide an execution layer across projects, sales, recruiting, procurement, vendors, office operations, and software delivery.',
    audiences: ['manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser', 'human'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'GOOGLEDRIVE', 'GITHUB', 'SLACK', 'MICROSOFT_TEAMS'],
    futureIntegrations: ['CRM', 'ATS', 'ERP', 'procurement', 'HRIS', 'project management'],
    maxAutonomy: 4,
    approvalRule: 'Preparation and internal coordination may be automated. Hiring, firing, purchasing, contracts, deployments, and external commitments follow dedicated authority rules.',
    tasks: [
      'Research prospects', 'Prepare sales outreach', 'Update CRM', 'Prepare proposals', 'Track pipeline', 'Draft job descriptions',
      'Organize candidates', 'Schedule interviews', 'Coordinate onboarding', 'Request vendor quotes', 'Compare suppliers', 'Prepare purchase orders',
      'Track projects', 'Track dependencies', 'Escalate blockers', 'Coordinate office vendors', 'Manage GitHub issues and pull requests',
      'Monitor CI', 'Prepare deployment changes',
    ],
    examples: ['Run the operating follow-up', 'What is blocked across the company?', 'Prepare the hiring pipeline'],
  },
  {
    id: 'legal-government-insurance',
    name: 'Legal, Government & Insurance Administration',
    mission: 'Own document gathering, deadlines, forms, records, and professional coordination without substituting for regulated advice.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser', 'professional'],
    toolkits: ['GMAIL', 'GOOGLECALENDAR', 'GOOGLEDRIVE', 'BROWSER_TOOL'],
    futureIntegrations: ['government portals', 'insurance portals', 'legal practice systems'],
    maxAutonomy: 2,
    approvalRule: 'Research, organization, and draft preparation are allowed. Filing, legal commitments, regulated advice, declarations, and binding submissions require user/professional approval.',
    professionalBoundary: 'Legal advice, representation, tax advice, and regulated insurance advice remain with qualified professionals.',
    tasks: [
      'Track passport expiry', 'Track licence and registration renewal', 'Track permits', 'Organize visa documents', 'Prepare government forms',
      'Track policy renewals', 'Compare insurance documents', 'Prepare claim evidence', 'Organize legal chronology', 'Collect evidence',
      'Track legal deadlines', 'Find appropriate professional', 'Prepare professional briefing packet', 'Track contract renewal dates',
      'Extract obligations and notice periods from contracts',
    ],
    examples: ['Prepare this for my lawyer', 'What government documents expire next?', 'Organize the insurance claim'],
  },
  {
    id: 'security-digital',
    name: 'Security & Digital Life',
    mission: 'Maintain visibility over accounts, devices, domains, subscriptions, privacy exposure, and basic security hygiene.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'professional'],
    toolkits: ['GMAIL', 'GOOGLEDRIVE', 'GITHUB'],
    futureIntegrations: ['password manager', 'domain registrar', 'device management', 'breach monitoring'],
    maxAutonomy: 2,
    approvalRule: 'Monitoring and recommendations are automatic. Credential changes, account closure, security configuration, or device control require explicit authorization.',
    tasks: [
      'Maintain account inventory', 'Maintain device inventory', 'Track domain renewals', 'Track software licences', 'Track cloud subscriptions',
      'Organize backups', 'Detect suspicious email', 'Coordinate breached credential response', 'Prepare lost-device procedure',
      'Coordinate privacy removal requests', 'Maintain emergency contact tree',
    ],
    examples: ['Audit my digital life', 'What accounts need attention?', 'Prepare a response plan for this security issue'],
  },
  {
    id: 'reputation-social',
    name: 'Reputation & Public Presence',
    mission: 'Monitor public signals, prepare responses, coordinate content, and protect the user or company’s public presence.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['ai', 'connector', 'browser', 'professional'],
    toolkits: ['COMPOSIO_SEARCH', 'ZERNIO_MCP'],
    futureIntegrations: ['review platforms', 'media monitoring', 'PR systems'],
    maxAutonomy: 3,
    approvalRule: 'Monitoring and drafting are automatic. Publishing, replying publicly, takedown requests, legal notices, or crisis statements require the configured authority.',
    tasks: [
      'Monitor mentions', 'Monitor news', 'Monitor reviews', 'Monitor social signals', 'Classify issues', 'Archive evidence',
      'Assess reach and velocity', 'Draft responses', 'Coordinate PR follow-up', 'Coordinate legal review', 'Prepare social content',
      'Schedule approved posts', 'Track content performance', 'Maintain personal brand assets',
    ],
    examples: ['What changed about my reputation today?', 'Prepare the response', 'Manage my public presence'],
  },
  {
    id: 'real-world-dispatch',
    name: 'Real-World Dispatch',
    mission: 'When software cannot finish the task, find and coordinate a trusted human or service to complete it in the physical world.',
    audiences: ['employee', 'manager', 'founder', 'ceo', 'principal'],
    channels: ['human', 'professional', 'voice', 'browser', 'connector'],
    toolkits: ['COMPOSIO_SEARCH', 'YELP', 'BROWSER_TOOL'],
    futureIntegrations: ['Taskrabbit', 'Uber Direct', 'DoorDash Drive', 'local concierge network', 'licensed professional network'],
    maxAutonomy: 4,
    approvalRule: 'Discovery and quote collection can be automatic. Dispatch requires approved vendor classes, location rules, cost thresholds, and access controls.',
    tasks: [
      'Find a courier', 'Find a cleaner', 'Find a handyman', 'Find a driver', 'Find a photographer', 'Find a translator',
      'Find a notary', 'Find a technician', 'Find a security provider', 'Find a licensed professional', 'Request quotes',
      'Compare availability', 'Book approved provider', 'Share task instructions', 'Coordinate access', 'Track arrival',
      'Verify completion', 'Collect invoice', 'Rate provider performance',
    ],
    examples: ['Get someone to handle this physically', 'Find, quote, and dispatch a provider', 'This cannot be done online—solve it'],
  },
] as const;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchLifeOperatorCapabilities(query: string, limit = 8): LifeOperatorDomain[] {
  const q = normalize(query);
  if (!q) return LIFE_OPERATOR_DOMAINS.slice(0, Math.max(1, Math.min(limit, LIFE_OPERATOR_DOMAINS.length)));
  const tokens = new Set(q.split(' ').filter((token) => token.length > 1));

  return LIFE_OPERATOR_DOMAINS
    .map((domain) => {
      let score = 0;
      const name = normalize(domain.name);
      const mission = normalize(domain.mission);
      if (q.includes(normalize(domain.id))) score += 10;
      if (q.includes(name)) score += 8;
      for (const token of tokens) {
        if (name.includes(token)) score += 3;
        if (mission.includes(token)) score += 2;
        if (domain.tasks.some((task) => normalize(task).includes(token))) score += 2;
        if (domain.examples.some((example) => normalize(example).includes(token))) score += 1;
      }
      return { domain, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.domain.name.localeCompare(b.domain.name))
    .slice(0, Math.max(1, Math.min(limit, LIFE_OPERATOR_DOMAINS.length)))
    .map((entry) => entry.domain);
}

export function lifeOperatorPrompt(query?: string) {
  const domains = query ? matchLifeOperatorCapabilities(query, 8) : LIFE_OPERATOR_DOMAINS;
  return [
    'ELP LIFE OPERATOR DOCTRINE:',
    'Your job is not merely to answer. Reduce work from the user’s life while preserving their authority, privacy, money, safety, and professional boundaries.',
    'For every mission, determine the correct execution owner: USER, AI, CONNECTOR, BROWSER, EMPLOYEE/VENDOR, or LICENSED PROFESSIONAL.',
    'Prefer direct authenticated APIs, then safe browser automation, then voice/human dispatch. Never claim a physical-world task is complete without verified evidence.',
    'Autonomy scale: L0 observe; L1 recommend; L2 prepare; L3 execute pre-authorized low-risk work; L4 execute only after explicit approval; L5 hand off to a human or licensed professional.',
    'Treat purchases, money movement, public publishing, contracts, legal filings, security changes, medical decisions, and other consequential actions as approval/professional-boundary tasks even when tools exist.',
    '',
    ...domains.map((domain) => [
      `DOMAIN ${domain.name} (${domain.id})`,
      `Mission: ${domain.mission}`,
      `Channels: ${domain.channels.join(', ')}`,
      `Current toolkits: ${domain.toolkits.length ? domain.toolkits.join(', ') : 'none yet'}`,
      `Future integrations: ${domain.futureIntegrations.join(', ')}`,
      `Maximum autonomy: L${domain.maxAutonomy}`,
      `Approval rule: ${domain.approvalRule}`,
      domain.professionalBoundary ? `Boundary: ${domain.professionalBoundary}` : '',
      `Representative tasks: ${domain.tasks.slice(0, 10).join('; ')}`,
    ].filter(Boolean).join('\n')).join('\n\n'),
  ].join('\n');
}
