import { useEffect, useState } from 'react';
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  subscribeToAnalyticsConsent,
  type AnalyticsConsent,
} from './consent';

/** Lets a player review or change the optional analytics choice later. */
export function AnalyticsConsentControl() {
  const [consent, setConsent] = useState<AnalyticsConsent>(() => getAnalyticsConsent());

  useEffect(() => {
    const unsubscribe = subscribeToAnalyticsConsent(() => setConsent(getAnalyticsConsent()));
    return unsubscribe;
  }, []);

  return (
    <div className="space-y-3">
      <p>
        Current choice:{' '}
        <strong>
          {consent === 'granted'
            ? 'analytics allowed'
            : consent === 'denied'
              ? 'analytics declined'
              : 'no choice made'}
        </strong>
        . You can change this choice at any time.
      </p>
      <div className="flex flex-wrap gap-2">
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
          Decline analytics
        </button>
      </div>
    </div>
  );
}
