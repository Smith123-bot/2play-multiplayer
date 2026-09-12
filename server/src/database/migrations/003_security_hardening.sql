-- ===========================================================================
-- 2PLAY — persistence privilege and atomicity hardening
-- ===========================================================================

-- The legacy SECURITY DEFINER function was callable by anon/authenticated.
-- That allowed anyone with the public Supabase project credentials to forge
-- arbitrary users' aggregate statistics. Only the trusted backend service role
-- may write match results.
revoke all on function record_match_result(uuid, text, text, integer) from public;
revoke all on function record_match_result(uuid, text, text, integer) from anon;
revoke all on function record_match_result(uuid, text, text, integer) from authenticated;
alter function record_match_result(uuid, text, text, integer) set search_path = public;
grant execute on function record_match_result(uuid, text, text, integer) to service_role;

-- Record aggregate statistics and history in one database transaction/RPC.
create or replace function record_match_with_history(
  p_user_id uuid,
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

  insert into game_history (
    user_id, game_id, room_id, players_json, winner_id,
    result, score, duration_seconds, played_at
  ) values (
    p_user_id,
    p_game_id,
    left(coalesce(p_room_id, ''), 64),
    coalesce(p_players, '[]'::jsonb),
    p_winner_id,
    p_result,
    coalesce(p_score, 0),
    greatest(coalesce(p_duration_seconds, 0), 0),
    now()
  );
end;
$$;

revoke all on function record_match_with_history(uuid, text, text, integer, text, jsonb, text, integer) from public;
revoke all on function record_match_with_history(uuid, text, text, integer, text, jsonb, text, integer) from anon;
revoke all on function record_match_with_history(uuid, text, text, integer, text, jsonb, text, integer) from authenticated;
grant execute on function record_match_with_history(uuid, text, text, integer, text, jsonb, text, integer) to service_role;
