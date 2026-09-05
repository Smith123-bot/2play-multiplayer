import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AVATARS, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '@2play/shared';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { useSessionStore } from '../stores/sessionStore';
import { authenticateSession } from '../multiplayer/session';
import { useUiStore } from '../stores/uiStore';
import { cn } from '../utils/cn';

/** Collects (or updates) the player nickname + avatar. Shown once per session. */
export function NicknamePrompt() {
  const open = useUiStore((store) => store.nicknamePromptOpen);
  const close = useUiStore((store) => store.closeNicknamePrompt);
  const resolvePending = useUiStore((store) => store.resolvePending);
  const nickname = useSessionStore((store) => store.nickname);
  const avatar = useSessionStore((store) => store.avatar);
  const setIdentity = useSessionStore((store) => store.setIdentity);

  const [name, setName] = useState(nickname);
  const [emoji, setEmoji] = useState(avatar);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(nickname);
      setEmoji(avatar);
      setError(null);
    }
  }, [open, nickname, avatar]);

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < NICKNAME_MIN_LENGTH) {
      setError(`Use at least ${NICKNAME_MIN_LENGTH} characters.`);
      return;
    }
    if (trimmed.length > NICKNAME_MAX_LENGTH) {
      setError(`Use at most ${NICKNAME_MAX_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setIdentity(trimmed, emoji);
    const session = await authenticateSession(trimmed, emoji);
    setBusy(false);
    if (!session) {
      toast.error('Could not create your session. Is the server running?');
      return;
    }
    resolvePending();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Who's playing?"
      description="Pick a nickname your friends will see. You can change it in Settings."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Continue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nickname"
          value={name}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder="e.g. LightningFox"
          error={error}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />

        <fieldset>
          <legend className="label">Avatar</legend>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setEmoji(option)}
                aria-label={`Choose avatar ${option}`}
                aria-pressed={emoji === option}
                className={cn(
                  'inline-flex h-11 w-11 items-center justify-center rounded-xl border text-xl transition',
                  emoji === option
                    ? 'border-primary-400 bg-primary-500/20'
                    : 'border-white/10 bg-white/5 hover:bg-white/10',
                )}
              >
                <span aria-hidden>{option}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
