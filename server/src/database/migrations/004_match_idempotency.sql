-- ===========================================================================
-- 2PLAY — durable match-result idempotency
-- ===========================================================================
-- A process-local duplicate set cannot protect a retry after a reconnect,
-- deploy, or process restart. Every new history row therefore carries the
-- server-generated match identifier and the database owns its uniqueness.

alter table game_history
  add column if not exists match_id text;

-- PostgreSQL permits multiple NULL values in a unique index, so existing
-- pre-migration rows remain valid while every new RPC call supplies a key.
create unique index if not exists idx_game_history_user_match_id
  on game_history (user_id, match_id);

-- Replace the pre-hardening eight-argument overload rather than leaving a
-- callable function that can bypass the durable match key.
drop function if exists record_match_with_history(uuid, text, text, integer, text, jsonb, text, integer);

create or replace function record_match_with_history(
  p_user_id uuid,
  p_match_id text,
  p_game_id text,
  p_result text,
  p_score integer,
  p_room_id text,
  p_players jsonb,
  p_winner_id text,
  p_duration_seconds integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_result not in ('win', 'loss', 'draw') then
    raise exception 'invalid match result';
  end if;
  if p_game_id !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'invalid game id';
  end if;
  if p_match_id is null or p_match_id !~ '^[A-Za-z0-9:_-]{1,128}$' then
    raise exception 'invalid match id';
  end if;

  -- Insert history first. If the same user/match is delivered again, the
  -- conflict means the aggregate update is skipped as part of this same
  -- transaction, so retries can never increment statistics twice.
  insert into game_history (
    user_id, match_id, game_id, room_id, players_json, winner_id,
    result, score, duration_seconds, played_at
  ) values (
    p_user_id,
    p_match_id,
    p_game_id,
    left(coalesce(p_room_id, ''), 64),
    coalesce(p_players, '[]'::jsonb),
    p_winner_id,
    p_result,
    coalesce(p_score, 0),
    greatest(coalesce(p_duration_seconds, 0), 0),
    now()
  )
  on conflict (user_id, match_id) do nothing;

  if not found then
    return;
  end if;

  insert into statistics (user_id, game_id, wins, losses, draws, total_played, best_score)
  values (
    p_user_id,
    p_game_id,
    case when p_result = 'win' then 1 else 0 end,
    case when p_result = 'loss' then 1 else 0 end,
    case when p_result = 'draw' then 1 else 0 end,
    1,
    greatest(coalesce(p_score, 0), 0)
  )
  on conflict (user_id, game_id) do update
    set wins         = statistics.wins + case when p_result = 'win' then 1 else 0 end,
        losses       = statistics.losses + case when p_result = 'loss' then 1 else 0 end,
        draws        = statistics.draws + case when p_result = 'draw' then 1 else 0 end,
        total_played = statistics.total_played + 1,
        best_score   = greatest(statistics.best_score, coalesce(p_score, 0)),
        updated_at   = now();
end;
$$;

revoke all on function record_match_with_history(uuid, text, text, text, integer, text, jsonb, text, integer) from public;
revoke all on function record_match_with_history(uuid, text, text, text, integer, text, jsonb, text, integer) from anon;
revoke all on function record_match_with_history(uuid, text, text, text, integer, text, jsonb, text, integer) from authenticated;
grant execute on function record_match_with_history(uuid, text, text, text, integer, text, jsonb, text, integer) to service_role;
