import { useEffect } from 'react';
import { RotateCcw, Volume2, Vibrate, Palette, User } from 'lucide-react';
import { AVATARS, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '@2play/shared';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Slider } from '../components/ui/Slider';
import { Toggle } from '../components/ui/Toggle';
import { Select } from '../components/ui/Select';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { audioManager } from '../audio/AudioManager';
import { ALL_SOUNDS } from '../audio/sounds';
import { hapticsManager } from '../haptics/HapticsManager';
import { cn } from '../utils/cn';

export function SettingsScreen() {
  const settings = useSettingsStore();
  const nickname = useSessionStore((store) => store.nickname);
  const avatar = useSessionStore((store) => store.avatar);
  const setIdentity = useSessionStore((store) => store.setIdentity);
  const session = useSessionStore((store) => store.session);
  const connection = useConnectionStore((store) => store.state);
  const clearStatistics = useStatisticsStore((store) => store.clear);
  const clearFavorites = useFavoritesStore((store) => store.clear);

  useEffect(() => {
    void useStatisticsStore.getState().load();
    void useFavoritesStore.getState().load();
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Sound, haptics, profile and connection.</p>
      </header>

      <Card>
        <CardHeader title="Profile" subtitle="Visible to other players in the room" icon={<User className="h-4 w-4" />} />
        <div className="space-y-4">
          <Input
            label="Nickname"
            value={nickname}
            maxLength={NICKNAME_MAX_LENGTH}
            onChange={(event) => setIdentity(event.target.value, avatar)}
            hint={`${NICKNAME_MIN_LENGTH}–${NICKNAME_MAX_LENGTH} characters.`}
          />
          <fieldset>
            <legend className="label">Avatar</legend>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setIdentity(nickname, option)}
                  aria-pressed={avatar === option}
                  aria-label={`Avatar ${option}`}
                  className={cn(
                    'inline-flex h-11 w-11 items-center justify-center rounded-xl border text-xl transition',
                    avatar === option
                      ? 'border-primary-400 bg-primary-500/20'
                      : 'border-white/10 bg-white/5 hover:bg-white/10',
                  )}
                >
                  <span aria-hidden>{option}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">
            {session ? `Session ${session.userId.slice(0, 8)} · signed in` : 'Not signed in yet.'}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Audio" subtitle="Procedural sounds — no audio files, no licensing issues" icon={<Volume2 className="h-4 w-4" />} />
        <Toggle
          label="Mute everything"
          checked={settings.audio.muted}
          onChange={() => settings.toggleMute()}
        />
        <Slider
          id="master-volume"
          label="Master volume"
          value={settings.audio.masterVolume}
          onValueChange={(masterVolume) => settings.setAudio({ masterVolume })}
        />
        <Slider
          id="sfx-volume"
          label="Sound effects"
          value={settings.audio.sfxVolume}
          onValueChange={(sfxVolume) => settings.setAudio({ sfxVolume })}
        />
        <Slider
          id="music-volume"
          label="Ambient music"
          value={settings.audio.musicVolume}
          onValueChange={(musicVolume) => settings.setAudio({ musicVolume })}
        />
        <div className="flex flex-wrap gap-2 pt-2">
          {ALL_SOUNDS.slice(0, 8).map((sound) => (
            <Button
              key={sound}
              size="sm"
              variant="secondary"
              onClick={() => {
                audioManager.unlock();
                audioManager.play(sound);
              }}
            >
              {sound}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Haptics" subtitle="Vibration feedback on supported devices" icon={<Vibrate className="h-4 w-4" />} />
        <Toggle
          label="Enable haptics"
          description={hapticsManager.isSupported() ? 'Supported on this device.' : 'Not supported on this device.'}
          checked={settings.hapticsEnabled}
          onChange={(value) => settings.setHaptics(value)}
          disabled={!hapticsManager.isSupported()}
        />
        <div className="flex flex-wrap gap-2 pt-2">
          {(['buttonPress', 'countdown', 'gameStart', 'success', 'error', 'victory'] as const).map((pattern) => (
            <Button
              key={pattern}
              size="sm"
              variant="secondary"
              disabled={!settings.hapticsEnabled}
              onClick={() => hapticsManager.trigger(pattern)}
            >
              {pattern}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Appearance" icon={<Palette className="h-4 w-4" />} />
        <Select
          id="theme"
          label="Theme"
          value={settings.theme}
          onChange={(event) => settings.setTheme(event.target.value as 'dark' | 'light')}
          options={[
            { value: 'dark', label: 'Dark (default)' },
            { value: 'light', label: 'Light' },
          ]}
        />
        <Toggle
          label="Reduce motion"
          description="Minimise animations across the interface."
          checked={settings.reduceMotion}
          onChange={(value) => settings.setReduceMotion(value)}
        />
      </Card>

      <Card>
        <CardHeader title="Connection" subtitle="Live multiplayer status" />
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-400">Socket</dt>
            <dd className={connection === 'CONNECTED' ? 'text-success' : 'text-warning'}>{connection}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Session</dt>
            <dd className="text-slate-200">{session ? 'Active' : 'None'}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Danger zone" subtitle="Local data only — server data is untouched" />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={() => {
              settings.reset();
              clearStatistics();
              clearFavorites();
            }}
          >
            Reset settings & local caches
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default SettingsScreen;
