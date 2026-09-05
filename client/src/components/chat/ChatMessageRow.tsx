import type { ChatMessage } from '@2play/shared';
import { cn } from '../../utils/cn';

export function ChatMessageRow({
  message,
  isMine,
}: {
  message: ChatMessage;
  isMine: boolean;
}) {
  if (message.type === 'system') {
    return (
      <p className="my-1 text-center text-xs italic text-slate-500">
        <span aria-hidden>{message.avatar} </span>
        {message.text}
      </p>
    );
  }

  if (message.type === 'emote') {
    return (
      <div className={cn('my-1 flex items-center gap-2', isMine && 'flex-row-reverse')}>
        <span className="text-xl" aria-hidden>
          {message.emote}
        </span>
        <span className="text-xs text-slate-400">{isMine ? 'You' : message.nickname}</span>
      </div>
    );
  }

  return (
    <div className={cn('my-1 flex flex-col', isMine && 'items-end')}>
      <span className="text-[11px] font-medium text-slate-400">
        {isMine ? 'You' : message.nickname}
      </span>
      <p
        className={cn(
          'max-w-[85%] break-words rounded-2xl px-3 py-2 text-sm',
          isMine ? 'bg-primary-500/25 text-white' : 'bg-white/5 text-slate-200',
        )}
      >
        {message.text}
      </p>
    </div>
  );
}
