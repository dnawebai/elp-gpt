export type ElpGreetingPeriod = 'morning' | 'afternoon' | 'evening';

export function greetingPeriodForHour(hour: number): ElpGreetingPeriod {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  if (normalized >= 5 && normalized < 12) return 'morning';
  if (normalized >= 12 && normalized < 18) return 'afternoon';
  return 'evening';
}

export function elpTimeGreeting(date = new Date()) {
  return `Good ${greetingPeriodForHour(date.getHours())}, Sir. ELP is online.`;
}
