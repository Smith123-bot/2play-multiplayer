import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { CHAT_MAX_LENGTH, EMOTES, type ChatMessage } from '@2play/shared';
import { ChatMessageRow } from './ChatMessageRow';
import { useChatStore } from '../../stores/chatStore';
import { useRoomActions } from '../../hooks/useRoomActions';
import { useServerDeadline } from '../../hooks/useCountdown';
import { cn } from '../../utils/cn';

export interface ChatPanelProps {
  messages: ChatMessage[];
  myPlayerId: string | null;
  className?: string;
  compact?: boolean;
}

/** Chat works in the lobby, during the match and on the result screen. */
export function ChatPanel({ messages, myPlayerId, className, compact = false }: ChatPanelProps) {
  const { sendChat, sendEmote } = useRoomActions();
  const draft = useChatStore((store) => store.draft);
  const setDraft = useChatStore((store) => store.setDraft);
  const mutedUntil = useChatStore((store) => store.mutedUntil);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const muteRemaining = useServerDeadline(mutedUntil);
  const muted = mutedUntil !== null && muteRemaining > 0;

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || muted || sending) return;
    setSending(true);
    const ok = await sendChat({ text });
    setSending(false);
    if (ok) setDraft('');
  };

  const remaining = CHAT_MAX_LENGTH - draft.length;

  return (
    <section
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface/70', className)}
      aria-label="Room chat"
    >
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-white">Chat</h3>
        {muted ? (
          <span className="text-xs font-medium text-danger" role="status">
            Muted {Math.ceil(muteRemaining / 1000)}s
          </span>
        ) : null}
      </header>

      <div
        ref={listRef}
        className={cn('flex-1 overflow-y-auto px-3 py-2', compact ? 'max-h-52' : 'min-h-[160px] max-h-[320px]')}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">No messages yet. Say hi! 👋</p>
        ) : (
          messages.map((message) => (
            <ChatMessageRow key={message.id} message={message} isMine={message.playerId === myPlayerId} />
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-white/5 px-2 py-1.5">
        {EMOTES.map((emote) => (
          <button
            key={emote}
            type="button"
            disabled={muted}
            onClick={() => void sendEmote({ emote })}
            aria-label={`Send ${emote} emote`}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-lg transition hover:bg-white/10 disabled:opacity-40"
          >
            <span aria-hidden>{emote}</span>
          </button>
        ))}
      </div>

      <form
        className="flex items-end gap-2 border-t border-white/5 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Chat message
        </label>
        <input
          id="chat-input"
          value={draft}
          maxLength={CHAT_MAX_LENGTH}
          disabled={muted}
          placeholder={muted ? 'You are muted' : 'Type a message…'}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-touch flex-1 rounded-xl border border-white/10 bg-background/70 px-3 py-2 text-sm placeholder:text-slate-500 focus:border-primary-400"
        />
        <span
          className={cn(
            'hidden text-[10px] tabular-nums sm:block',
            remaining < 20 ? 'text-warning' : 'text-slate-500',
          )}
        >
          {remaining}
        </span>
        <button
          type="submit"
          disabled={muted || sending || draft.trim().length === 0}
          aria-label="Send message"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500 text-white transition hover:bg-primary-400 disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </section>
  );
}
