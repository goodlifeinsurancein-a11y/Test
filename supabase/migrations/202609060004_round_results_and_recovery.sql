create or replace function public.finance_record_round_result(p_round_id uuid, p_status text, p_result jsonb, p_result_at timestamptz, p_completed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_round public.game_rounds%rowtype;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if not found then raise exception 'round not found'; end if;
  if v_round.result is not null and v_round.result <> p_result then raise exception 'round result is immutable'; end if;
  update public.game_rounds set status = p_status, result = coalesce(v_round.result, p_result), result_at = coalesce(v_round.result_at, p_result_at), completed_at = coalesce(p_completed_at, completed_at), updated_at = now() where id = p_round_id;
  return jsonb_build_object('round_id', p_round_id, 'already_recorded', v_round.result is not null);
end;
$$;

-- A process restart cannot invent a result. Rounds with an unrecorded result
-- are explicitly marked for operator/recovery handling, never auto-randomized.
create or replace function public.finance_mark_interrupted_rounds_for_recovery()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.game_rounds set status = 'RECOVERY_REQUIRED', updated_at = now()
  where status not in ('COMPLETED','RECOVERY_REQUIRED') and result is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.finance_record_round_result(uuid,text,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.finance_mark_interrupted_rounds_for_recovery() from public, anon, authenticated;
