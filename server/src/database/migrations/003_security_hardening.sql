-- 2PLAY security hardening
-- The Node server uses the service-role key for this server-authoritative
-- operation. Anonymous/browser roles must not be able to write statistics for
-- an arbitrary user id through a SECURITY DEFINER function.
revoke execute on function record_match_result(uuid, text, text, integer) from anon;
revoke execute on function record_match_result(uuid, text, text, integer) from authenticated;
grant execute on function record_match_result(uuid, text, text, integer) to service_role;
