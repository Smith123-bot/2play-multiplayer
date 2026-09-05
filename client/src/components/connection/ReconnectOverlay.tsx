import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useServerDeadline } from '../../hooks/useCountdown';

/**
 * Shown over the room while the local player is inside the 120 second
 * reconnection grace period. The room underneath keeps updating normally.
 */
export function ReconnectOverlay() {
  const state = useConnectionStore((store) => store.state);
  const deadline = useConnectionStore((store) => store.reconnectDeadline);
  const remaining = useServerDeadline(deadline);
  const seconds = Math.ceil(remaining / 1000);
  const visible = state === 'RECONNECTING' || (state === 'DISCONNECTED' && deadline !== null);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm"
          role="alertdialog"
          aria-live="assertive"
          aria-label="Connection lost"
        >
          <div className="card mx-4 max-w-sm p-6 text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary-300" aria-hidden />
            <h2 className="text-lg font-semibold text-white">Connection lost</h2>
            <p className="mt-1 text-sm text-slate-400">
              Reconnecting… Your seat is held for{' '}
              <span className="font-semibold text-primary-300 tabular-nums">{seconds}s</span>.
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Keep this tab open. Your game, score and chat are safe.
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
