import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';

/** Non-blocking banner: the app stays usable while the socket reconnects. */
export function ConnectionBanner() {
  const state = useConnectionStore((store) => store.state);
  const message = useConnectionStore((store) => store.message);

  return (
    <AnimatePresence>
      {state !== 'CONNECTED' ? (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-warning/30 bg-warning/10"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm text-amber-200">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              {state === 'CONNECTING'
                ? 'Connecting to 2PLAY…'
                : state === 'RECONNECTING'
                  ? 'Connection lost. Reconnecting…'
                  : 'Disconnected.'}
              {message ? ` ${message}` : ''}
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
