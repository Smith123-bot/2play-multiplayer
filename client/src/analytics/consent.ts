import { readString, writeString } from '../utils/storage';

export type AnalyticsConsent = 'granted' | 'denied' | null;

const CONSENT_STORAGE_KEY = '2play.analyticsConsent';
const CONSENT_EVENT = 'duoplay:analytics-consent';

function isAnalyticsConsent(value: string): value is Exclude<AnalyticsConsent, null> {
  return value === 'granted' || value === 'denied';
}

/**
 * Analytics is opt-in. An absent value means the player has not made a choice
 * yet; it is deliberately different from `denied` so the consent notice can be
 * shown without loading any third-party code.
 */
export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return null;
  const value = readString(CONSENT_STORAGE_KEY);
  return isAnalyticsConsent(value) ? value : null;
}

export function setAnalyticsConsent(consent: Exclude<AnalyticsConsent, null>): void {
  if (typeof window === 'undefined') return;
  writeString(CONSENT_STORAGE_KEY, consent);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
}

/** Keeps consent controls in separate parts of the SPA in sync. */
export function subscribeToAnalyticsConsent(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handleConsentEvent = () => listener();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY) listener();
  };

  window.addEventListener(CONSENT_EVENT, handleConsentEvent);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CONSENT_EVENT, handleConsentEvent);
    window.removeEventListener('storage', handleStorage);
  };
}

export const ANALYTICS_CONSENT_STORAGE_KEY = CONSENT_STORAGE_KEY;
