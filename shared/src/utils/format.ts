/** Small shared formatting helpers used by both client UI and server messages. */

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function formatCountdown(secondsRemaining: number): string {
  const value = Math.max(0, Math.ceil(secondsRemaining));
  return value <= 0 ? 'GO' : String(value);
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function initials(nickname: string): string {
  const clean = (nickname ?? '').trim();
  if (!clean) return '?';
  return clean.slice(0, 2).toUpperCase();
}
