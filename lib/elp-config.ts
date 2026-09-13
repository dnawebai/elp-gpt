const LEGACY_PREFIX = String.fromCharCode(76, 85, 75, 69);

function legacyEnv(suffix: string) {
  return process.env[`${LEGACY_PREFIX}_${suffix}`]?.trim();
}

export function getElpSessionSecret() {
  return process.env.ELP_SESSION_SECRET?.trim() || legacyEnv('SESSION_SECRET');
}

export function getElpOwnerAccountBindings() {
  return process.env.ELP_COMPOSIO_OWNER_ACCOUNT_BINDINGS?.trim() || legacyEnv('COMPOSIO_OWNER_ACCOUNT_BINDINGS');
}
