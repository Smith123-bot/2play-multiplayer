import { AnimatePresence, motion } from 'framer-motion';

/** Server-authoritative countdown: the value comes from the server snapshot. */
export function CountdownOverlay({ value, visible }: { value: number; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            key={value}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="grid h-32 w-32 place-items-center rounded-full border border-white/15 bg-background/80 backdrop-blur-md"
          >
            <span
              className={`font-black ${
                value === 0 ? 'text-5xl text-success' : 'text-6xl text-gradient'
              }`}
              aria-live="assertive"
            >
              {value === 0 ? 'GO!' : value}
            </span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
