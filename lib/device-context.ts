export type ElpDeviceContext = {
  capturedAt: string;
  timezone?: string;
  locale?: string;
  online?: boolean;
  userAgent?: string;
  platform?: string;
  osVersion?: string;
  modelName?: string;
  deviceName?: string;
  appState?: 'active' | 'background' | 'inactive' | 'unknown';
  appVersion?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    altitudeMeters?: number | null;
    headingDegrees?: number | null;
    speedMetersPerSecond?: number | null;
  };
};

function cleanString(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

export function sanitizeDeviceContext(value: unknown): ElpDeviceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const capturedAt = typeof input.capturedAt === 'string' ? input.capturedAt.slice(0, 64) : new Date().toISOString();
  const result: ElpDeviceContext = { capturedAt };

  const timezone = cleanString(input.timezone, 80);
  const locale = cleanString(input.locale, 40);
  const userAgent = cleanString(input.userAgent, 500);
  const platform = cleanString(input.platform, 32);
  const osVersion = cleanString(input.osVersion, 80);
  const modelName = cleanString(input.modelName, 120);
  const deviceName = cleanString(input.deviceName, 120);
  const appVersion = cleanString(input.appVersion, 40);
  const appState = cleanString(input.appState, 20);
  if (timezone) result.timezone = timezone;
  if (locale) result.locale = locale;
  if (typeof input.online === 'boolean') result.online = input.online;
  if (userAgent) result.userAgent = userAgent;
  if (platform) result.platform = platform;
  if (osVersion) result.osVersion = osVersion;
  if (modelName) result.modelName = modelName;
  if (deviceName) result.deviceName = deviceName;
  if (appVersion) result.appVersion = appVersion;
  result.appState = appState && ['active','background','inactive','unknown'].includes(appState)
    ? appState as ElpDeviceContext['appState']
    : 'unknown';

  const rawLocation = input.location;
  if (rawLocation && typeof rawLocation === 'object' && !Array.isArray(rawLocation)) {
    const location = rawLocation as Record<string, unknown>;
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180
    ) {
      const accuracy = Number(location.accuracyMeters);
      const altitude = location.altitudeMeters == null ? null : Number(location.altitudeMeters);
      const heading = location.headingDegrees == null ? null : Number(location.headingDegrees);
      const speed = location.speedMetersPerSecond == null ? null : Number(location.speedMetersPerSecond);
      result.location = {
        latitude,
        longitude,
        ...(Number.isFinite(accuracy) ? { accuracyMeters: Math.max(0, accuracy) } : {}),
        altitudeMeters: Number.isFinite(altitude) ? altitude : null,
        headingDegrees: Number.isFinite(heading) ? heading : null,
        speedMetersPerSecond: Number.isFinite(speed) ? speed : null,
      };
    }
  }

  return result;
}

export function deviceContextToPrompt(context: ElpDeviceContext | null) {
  if (!context) return '';
  const lines = [
    `Captured: ${context.capturedAt}`,
    context.timezone ? `Timezone: ${context.timezone}` : '',
    context.locale ? `Locale: ${context.locale}` : '',
    context.platform ? `Platform: ${context.platform}${context.osVersion ? ` ${context.osVersion}` : ''}` : '',
    context.modelName ? `Device model: ${context.modelName}` : '',
    context.deviceName ? `Device label: ${context.deviceName}` : '',
    context.appVersion ? `Companion version: ${context.appVersion}` : '',
    context.appState ? `Companion state: ${context.appState}` : '',
    typeof context.online === 'boolean' ? `Device online: ${context.online ? 'yes' : 'no'}` : '',
  ].filter(Boolean);

  if (context.location) {
    lines.push(
      `Authorized current coordinates: ${context.location.latitude.toFixed(6)}, ${context.location.longitude.toFixed(6)}`,
    );
    if (context.location.accuracyMeters !== undefined) {
      lines.push(`Location accuracy: approximately ${Math.round(context.location.accuracyMeters)} meters`);
    }
  }

  return lines.join('\n');
}
