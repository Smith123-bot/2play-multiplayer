-- ===========================================================================
-- 2PLAY — atomic persistence helpers
-- ===========================================================================

-- Records one finished match for one player.
-- Called through supabase.rpc('record_match_result', ...) by the server.
create or replace function record_match_result(
  p_user_id uuid,
  p_game_id text,
  p_result  text,
  p_score   integer
) returns void
language plpgsql
security definer
as $$
begin
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

grant execute on function record_match_result(uuid, text, text, integer) to service_role;
grant execute on function record_match_result(uuid, text, text, integer) to authenticated;
grant execute on function record_match_result(uuid, text, text, integer) to anon;
