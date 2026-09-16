import { describe, expect, it } from 'vitest';
import { listMigrations, readMigration } from './migrationRunner';

describe('database security migrations', () => {
  it('revokes public match-result writes and installs a service-role-only atomic RPC', () => {
    expect(listMigrations()).toContain('003_security_hardening.sql');
    expect(listMigrations()).toContain('004_match_idempotency.sql');
    const sql = readMigration('003_security_hardening.sql').toLowerCase();
    expect(sql).toContain('revoke all on function record_match_result');
    expect(sql).toContain('from anon');
    expect(sql).toContain('from authenticated');
    expect(sql).toContain('record_match_with_history');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public');
    expect(sql).toContain('grant execute on function record_match_with_history');
    expect(sql).toContain('to service_role');
  });
});

describe('durable match idempotency migration', () => {
  it('adds the server match key and gates the new atomic RPC to service role', () => {
    const sql = readMigration('004_match_idempotency.sql').toLowerCase();
    expect(sql).toContain('add column if not exists match_id');
    expect(sql).toContain('unique index if not exists idx_game_history_user_match_id');
    expect(sql).toContain('on conflict (user_id, match_id) do nothing');
    expect(sql).toContain('if not found then');
    expect(sql).toContain('p_match_id');
    expect(sql).toContain('revoke all on function record_match_with_history');
    expect(sql).toContain('to service_role');
  });
});
