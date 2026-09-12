import { describe, expect, it } from 'vitest';
import { listMigrations, readMigration } from './migrationRunner';

describe('database security migrations', () => {
  it('revokes public match-result writes and installs a service-role-only atomic RPC', () => {
    expect(listMigrations()).toContain('003_security_hardening.sql');
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
