import { Link } from 'react-router-dom';
import {
  setAnalyticsConsent,
  getAnalyticsConsent,
  subscribeToAnalyticsConsent,
  type AnalyticsConsent,
} from './consent';
import { useEffect, useState } from 'react';

/** A non-blocking, opt-in notice for the optional Google Analytics tag. */
export function AnalyticsConsentBanner() {
  const [consent, setConsent] = useState<AnalyticsConsent>(() => getAnalyticsConsent());

  useEffect(() => {
    const unsubscribe = subscribeToAnalyticsConsent(() => setConsent(getAnalyticsConsent()));
    return unsubscribe;
  }, []);

  if (consent !== null) return null;

  return (
    <aside
      role="dialog"
      aria-labelledby="analytics-consent-title"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-2xl rounded-2xl border border-primary-400/30 bg-surface/95 p-4 shadow-2xl backdrop-blur md:bottom-4"
    >
      <h2 id="analytics-consent-title" className="text-sm font-bold text-white">
        Help us improve DuoPlay
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">
        Optional Google Analytics helps us understand which pages and games are used. It is off
        until you choose to allow it, and we never send usernames, room codes, chat or private data.
        Read the{' '}
        <Link to="/privacy" className="font-medium text-primary-300 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary min-h-touch px-4 py-2 text-sm"
          onClick={() => setAnalyticsConsent('granted')}
        >
          Allow analytics
        </button>
        <button
          type="button"
          className="btn-ghost min-h-touch px-4 py-2 text-sm"
          onClick={() => setAnalyticsConsent('denied')}
        >
          No thanks
        </button>
      </div>
    </aside>
  );
}
