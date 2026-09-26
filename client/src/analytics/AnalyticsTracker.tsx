import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  initializeGoogleAnalytics,
  resetAnalyticsPageViewDeduplication,
  trackPageView,
  updateGoogleAnalyticsConsent,
} from './analytics';
import { getAnalyticsConsent, subscribeToAnalyticsConsent, type AnalyticsConsent } from './consent';

/**
 * React Router is the only page-view coordinator. The tag is configured with
 * automatic page views disabled, and the short delay lets route-level SEO
 * effects update document.title before the manual event is queued.
 */
export function AnalyticsTracker() {
  const location = useLocation();
  const [consent, setConsent] = useState<AnalyticsConsent>(() => getAnalyticsConsent());
  const routePath = useMemo(
    () => `${location.pathname}${location.search}${location.hash}`,
    [location.hash, location.pathname, location.search],
  );

  useEffect(() => {
    const unsubscribe = subscribeToAnalyticsConsent(() => setConsent(getAnalyticsConsent()));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (consent !== 'granted') {
      updateGoogleAnalyticsConsent(false);
      resetAnalyticsPageViewDeduplication();
      return;
    }

    initializeGoogleAnalytics();
    const timer = window.setTimeout(() => trackPageView(location.pathname), 0);
    return () => window.clearTimeout(timer);
  }, [consent, location.pathname, routePath]);

  return null;
}
