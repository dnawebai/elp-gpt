export type LukeDeviceContext = {
  capturedAt: string;
  timezone?: string;
  locale?: string;
  online?: boolean;
  userAgent?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    altitudeMeters?: number | null;
    headingDegrees?: number | null;
    speedMetersPerSecond?: number | null;
  };
};

export function sanitizeDeviceContext(value: unknown): LukeDeviceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const capturedAt = typeof input.capturedAt === 'string' ? input.capturedAt.slice(0, 64) : new Date().toISOString();
  const result: LukeDeviceContext = { capturedAt };

  if (typeof input.timezone === 'string' && input.timezone.length <= 80) result.timezone = input.timezone;
  if (typeof input.locale === 'string' && input.locale.length <= 40) result.locale = input.locale;
  if (typeof input.online === 'boolean') result.online = input.online;
  if (typeof input.userAgent === 'string') result.userAgent = input.userAgent.slice(0, 500);

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

export function deviceContextToPrompt(context: LukeDeviceContext | null) {
  if (!context) return '';
  const lines = [
    `Captured: ${context.capturedAt}`,
    context.timezone ? `Timezone: ${context.timezone}` : '',
    context.locale ? `Locale: ${context.locale}` : '',
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
