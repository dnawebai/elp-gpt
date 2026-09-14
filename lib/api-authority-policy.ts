import type { AuthorityCapability } from '@/lib/authority-policy';

const PUBLIC_EXACT = new Set([
  '/api/identity',
  '/api/healthz',
  '/api/device-agent',
  '/api/companion/enroll',
  '/api/voice/think',
]);

const PUBLIC_PREFIXES = ['/api/cron/', '/api/webhooks/'];

export function isPublicApiRoute(pathname: string) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function requiredApiCapability(pathname: string, method: string): AuthorityCapability {
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return 'read_context';

  if (pathname.startsWith('/api/authority-control') || pathname.startsWith('/api/security-operations')) return 'manage_authority';
  if (pathname.startsWith('/api/connections') || pathname.startsWith('/api/integration-health') || pathname.startsWith('/api/event-subscriptions') || pathname.startsWith('/api/subscription-lifecycle') || pathname.startsWith('/api/communications-sync')) return 'manage_integrations';
  if (pathname.startsWith('/api/device-control')) return 'control_devices';
  if (pathname.startsWith('/api/phone-control') || pathname.startsWith('/api/retell/')) return 'make_calls';
  if (pathname.startsWith('/api/execution-calendar-actions') || pathname.startsWith('/api/execution-schedule') || pathname.startsWith('/api/protected-blocks')) return 'manage_calendar';
  if (pathname.startsWith('/api/notification-delivery') || pathname.startsWith('/api/notifications')) return 'send_messages';
  if (pathname.startsWith('/api/actions/')) return 'read_context';
  if (pathname.startsWith('/api/passkeys') || pathname.startsWith('/api/authority-session')) return 'read_context';
  return 'manage_tasks';
}

export const UNIVERSAL_API_PUBLIC_ROUTES = Object.freeze([...PUBLIC_EXACT, ...PUBLIC_PREFIXES]);
