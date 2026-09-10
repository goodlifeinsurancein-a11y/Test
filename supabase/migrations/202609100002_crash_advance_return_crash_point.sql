-- ============================================================================
-- 202609100002: finance_advance_crash_round must return crash_point on RUNNING transition
-- ============================================================================
DROP FUNCTION IF EXISTS public.finance_advance_crash_round(uuid,text,numeric,timestamptz,jsonb);
CREATE OR REPLACE FUNCTION public.finance_advance_crash_round(
  p_round_id uuid,
  p_new_status text,
  p_current_multiplier numeric(10,2) default null,
  p_crashed_at timestamptz default null,
  p_result_data jsonb default null
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_round   public.game_rounds%rowtype;
  v_locked  boolean;
  v_crash_point numeric(10,2);
BEGIN
  -- Acquire advisory lock for single-writer
  v_locked := public.finance_acquire_round_lock(p_round_id, 'crash', p_new_status);
  IF NOT v_locked THEN
    RAISE EXCEPTION 'could not acquire round lock; another instance is processing this round';
  END IF;

  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id AND game_key = 'crash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found'; END IF;

  -- Validate state transitions
  IF v_round.status = 'BETTING' AND p_new_status = 'LOCK' THEN
    UPDATE public.game_rounds SET status = 'LOCK', locked_at = now(), updated_at = now() WHERE id = p_round_id;
  ELSIF v_round.status = 'LOCK' AND p_new_status = 'RUNNING' THEN
    -- Generate crash point if not already generated
    IF v_round.crash_point IS NULL THEN
      PERFORM public.finance_generate_crash_point(p_round_id, 'crash');
    END IF;
    SELECT crash_point INTO v_crash_point FROM public.game_rounds WHERE id = p_round_id;
    UPDATE public.game_rounds SET status = 'RUNNING', running_at = now(), current_multiplier = 1.00, updated_at = now() WHERE id = p_round_id;
  ELSIF v_round.status = 'RUNNING' AND p_new_status = 'RUNNING' THEN
    -- Multiplier update
    UPDATE public.game_rounds SET current_multiplier = p_current_multiplier, updated_at = now() WHERE id = p_round_id;
  ELSIF v_round.status = 'RUNNING' AND p_new_status = 'CRASH' THEN
    UPDATE public.game_rounds
      SET status = 'CRASH', crashed_at = coalesce(p_crashed_at, now()),
          current_multiplier = v_round.crash_point,
          result_data = p_result_data, updated_at = now()
      WHERE id = p_round_id;
  ELSIF v_round.status = 'CRASH' AND p_new_status = 'RESULT' THEN
    UPDATE public.game_rounds SET status = 'RESULT', result_at = now(), result_data = coalesce(v_round.result_data, p_result_data), updated_at = now() WHERE id = p_round_id;
  ELSIF v_round.status = 'RESULT' AND p_new_status = 'COMPLETED' THEN
    UPDATE public.game_rounds SET status = 'COMPLETED', completed_at = now(), recovery_state = 'COMPLETED', updated_at = now() WHERE id = p_round_id;
  ELSE
    RAISE EXCEPTION 'invalid state transition: % -> %', v_round.status, p_new_status;
  END IF;

  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id;
  RETURN jsonb_build_object(
    'round_id', v_round.id,
    'status', v_round.status,
    'current_multiplier', v_round.current_multiplier,
    'crash_point', v_round.crash_point
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finance_advance_crash_round(uuid,text,numeric,timestamptz,jsonb) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_advance_crash_round(uuid,text,numeric,timestamptz,jsonb) TO service_role;
