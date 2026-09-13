import { describe, expect, it } from 'vitest';
import { cn } from './cn';
import { formatCategory, formatDuration, formatPercent, ordinal, playerName } from './format';
import { readJson, readString, removeKey, writeJson, writeString } from './storage';

describe('utils', () => {
  it('merges tailwind class names', () => {
    expect(cn('btn', 'btn-primary')).toBe('btn btn-primary');
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', undefined, 'text-white')).toBe('text-sm text-white');
  });

  it('formats category ids as display words', () => {
    expect(formatCategory('reflex')).toBe('Reflex');
    expect(formatCategory('coop')).toBe('Coop');
    expect(formatCategory('word')).toBe('Word');
    // Hyphenated or multi-word ids stay readable, and the transform is stable
    // so a card and the filter dropdown cannot disagree.
    expect(formatCategory('sports-arcade')).toBe('Sports Arcade');
    expect(formatCategory(formatCategory('reflex'))).toBe('Reflex');
    expect(formatCategory('')).toBe('');
  });

  it('formats durations and percentages', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatPercent(42.4)).toBe('42%');
    expect(formatPercent(-5)).toBe('0%');
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(3)).toBe('3rd');
  });

  it('resolves player names safely', () => {
    const players = [
      { id: 'a', nickname: 'Ada' },
      { id: 'b', nickname: 'Bob' },
    ] as never;
    expect(playerName(players, 'b')).toBe('Bob');
    expect(playerName(players, 'missing')).toBe('Unknown');
    expect(playerName(players, null)).toBe('—');
  });

  it('reads and writes local storage defensively', () => {
    writeJson('test.key', { a: 1 });
    expect(readJson('test.key', { a: 0 })).toEqual({ a: 1 });
    writeString('test.str', 'value');
    expect(readString('test.str')).toBe('value');
    removeKey('test.str');
    expect(readString('test.str', 'fallback')).toBe('fallback');
    expect(readJson('missing.key', { default: true })).toEqual({ default: true });
  });
});
