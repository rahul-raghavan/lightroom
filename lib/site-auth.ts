export const SITE_AUTH_COOKIE = 'lightroom_site_access';

export function getConfiguredSitePassword(): string | null {
  const configured = process.env.SITE_PASSWORD?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === 'development' ? 'darkroom' : null;
}

export function isSitePasswordConfigured(): boolean {
  return Boolean(getConfiguredSitePassword());
}

export function isSitePasswordValid(password: string): boolean {
  const expected = getConfiguredSitePassword();
  if (!expected) return false;
  return password === expected;
}

export function hasSiteAccessCookie(value: string | undefined): boolean {
  return value === 'granted';
}
