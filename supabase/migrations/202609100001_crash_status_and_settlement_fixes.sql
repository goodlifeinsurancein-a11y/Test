-- ============================================================================
-- 202609100001: Fix CRASH status constraint and auto-settlement
--
-- Issues fixed:
-- 1. game_rounds CHECK constraint uses 'CRASHED' but crash engine uses 'CRASH'
-- 2. finance_auto_settle_crash_round has undeclared v_record and bypasses
--    idempotent settlement RPC, causing missing ledger entries
-- 3. finance_crash_cashout_atomic uses floating-point payout calculation
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix game_rounds status CHECK constraint: add 'CRASH'
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_rounds
  DROP CONSTRAINT IF EXISTS game_rounds_status_check;

ALTER TABLE public.game_rounds
  ADD CONSTRAINT game_rounds_status_check
  CHECK (status IN (
    'BETTING','LOCK','PROCESSING','RUNNING','CRASH','CRASHED','DEAL',
    'COMPARE','GENERATE_RESULT','INDICATOR','MATCH','RESULT',
    'SETTLEMENT','COMPLETED','CANCELLED','RECOVERY_REQUIRED'
  ));

-- ---------------------------------------------------------------------------
-- 2. Rewrite finance_auto_settle_crash_round to use the idempotent
--    finance_settle_bet_atomic RPC for every unsettled bet. This ensures:
--    - wallet ledger entries are written
--    - idempotency is enforced
--    - the bet status and payout fields are updated
--    - settlement row is created via the standard path
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_auto_settle_crash_round(uuid);
CREATE OR REPLACE FUNCTION public.finance_auto_settle_crash_round(p_round_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_round        public.game_rounds%rowtype;
  v_bet          public.game_bets%rowtype;
  v_settled_count integer := 0;
  v_payout       bigint;
  v_outcome      text;
  v_idem_key     text;
  v_result       jsonb;
  v_response     jsonb;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds
    WHERE id = p_round_id AND game_key = 'crash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found'; END IF;

  IF v_round.status <> 'CRASH' AND v_round.status <> 'RESULT' THEN
    RAISE EXCEPTION 'round must be in CRASH or RESULT state for auto-settlement';
  END IF;

  IF v_round.crash_point IS NULL THEN
    RAISE EXCEPTION 'crash point not set';
  END IF;

  FOR v_bet IN
    SELECT * FROM public.game_bets
    WHERE round_id = p_round_id
      AND game_key = 'crash'
      AND status IN ('PLACED', 'ACTIVE')
    ORDER BY created_at
  LOOP
    -- Skip bets already settled
    IF EXISTS (
      SELECT 1 FROM public.game_settlements WHERE bet_id = v_bet.id
    ) THEN
      CONTINUE;
    END IF;

    -- Determine outcome and payout
    IF v_bet.bet_data ? 'autoCashoutMultiplier' THEN
      IF (v_bet.bet_data->>'autoCashoutMultiplier')::numeric <= v_round.crash_point THEN
        -- Auto-cashout would have triggered
        v_payout   := (v_bet.amount * (v_bet.bet_data->>'autoCashoutMultiplier')::numeric)::bigint;
        v_outcome  := 'CASHOUT';
        v_idem_key := 'crash-auto-settle:' || p_round_id::text || ':' || v_bet.id::text || ':cashout';
      ELSE
        -- Auto-cashout would NOT have triggered before crash
        v_payout   := 0;
        v_outcome  := 'LOSS';
        v_idem_key := 'crash-auto-settle:' || p_round_id::text || ':' || v_bet.id::text || ':loss';
      END IF;
    ELSE
      -- No auto-cashout set: LOSS
      v_payout   := 0;
      v_outcome  := 'LOSS';
      v_idem_key := 'crash-auto-settle:' || p_round_id::text || ':' || v_bet.id::text || ':loss';
    END IF;

    -- Use the standard idempotent settlement RPC.
    -- This writes wallet ledger, pool ledger, settlement row, and updates bet.
    BEGIN
      v_result := public.finance_settle_bet_atomic(
        v_bet.id,
        v_outcome,
        v_payout,
        v_idem_key,
        v_idem_key  -- request_hash = idempotency_key for deterministic replay
      );
      v_settled_count := v_settled_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Bet already settled or concurrent settlement — skip
      NULL;
    END;
  END LOOP;

  v_response := jsonb_build_object(
    'round_id', p_round_id,
    'auto_settled_count', v_settled_count
  );
  RETURN v_response;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Fix finance_crash_cashout_atomic payout calculation to use integer
--    arithmetic: multiplier_cents (integer) * amount_units, then integer
--    divide by 100 to get exact deci-token payout. This eliminates
--    floating-point truncation errors.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_crash_cashout_atomic(uuid,numeric,text,text);
CREATE OR REPLACE FUNCTION public.finance_crash_cashout_atomic(
  p_bet_id uuid,
  p_cashout_multiplier numeric(10,2),
  p_idempotency_key text,
  p_request_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_record     public.idempotency_records%rowtype;
  v_bet        public.game_bets%rowtype;
  v_round      public.game_rounds%rowtype;
  v_pool       public.game_wallets%rowtype;
  v_player     public.wallets%rowtype;
  v_owner      public.wallets%rowtype;
  v_shortfall  bigint;
  v_mult_cents bigint;
  v_return_units bigint;
  v_response   jsonb;
  v_settlement_id uuid;
BEGIN
  -- Idempotency check
  SELECT * INTO v_record FROM public.idempotency_records
    WHERE operation = 'CRASH_CASHOUT' AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_record.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request';
    END IF;
    RETURN v_record.response;
  END IF;

  SELECT * INTO v_bet FROM public.game_bets WHERE id = p_bet_id AND game_key = 'crash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bet not found'; END IF;

  SELECT * INTO v_round FROM public.game_rounds WHERE id = v_bet.round_id AND game_key = 'crash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found'; END IF;

  -- Cashout only during RUNNING
  IF v_round.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'cashout only allowed during RUNNING phase';
  END IF;

  IF v_round.current_multiplier IS NULL OR p_cashout_multiplier > v_round.current_multiplier THEN
    RAISE EXCEPTION 'cashout multiplier exceeds current multiplier';
  END IF;

  -- Already settled check
  IF EXISTS (SELECT 1 FROM public.game_settlements WHERE bet_id = p_bet_id) THEN
    RAISE EXCEPTION 'bet already settled';
  END IF;

  IF v_bet.status IN ('CASHED_OUT', 'WON', 'LOST') THEN
    RAISE EXCEPTION 'bet already settled';
  END IF;

  -- Exact integer payout: multiplier_cents * amount_units / 100
  -- This avoids floating-point truncation
  v_mult_cents   := round(p_cashout_multiplier * 100)::bigint;
  v_return_units := (v_bet.amount * v_mult_cents) / 100;

  -- Ensure pool liquidity
  SELECT * INTO v_pool FROM public.game_wallets WHERE game_id = 'crash' FOR UPDATE;

  IF v_return_units > v_pool.balance_units THEN
    v_shortfall := v_return_units - v_pool.balance_units;
    SELECT w.* INTO v_owner FROM public.wallets w
      JOIN public.coin_supply s ON s.owner_user_id = w.user_id
      WHERE s.singleton FOR UPDATE;
    IF NOT FOUND OR v_owner.balance_units < v_shortfall THEN
      RAISE EXCEPTION 'insufficient owner game liquidity';
    END IF;

    UPDATE public.wallets
      SET balance_units = v_owner.balance_units - v_shortfall, updated_at = now()
      WHERE id = v_owner.id;
    PERFORM public.finance_write_wallet_ledger(
      v_owner.user_id, v_owner.id, 'crash', v_bet.round_id,
      'GAME_LIQUIDITY_DEBIT', -v_shortfall,
      v_owner.balance_units, v_owner.balance_units - v_shortfall,
      p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');

    UPDATE public.game_wallets
      SET balance_units = balance_units + v_shortfall, updated_at = now()
      WHERE id = v_pool.id;
    PERFORM public.finance_write_pool_ledger(
      v_pool.id, v_bet.round_id, 'GAME_LIQUIDITY_CREDIT', v_shortfall,
      v_pool.balance_units, v_pool.balance_units + v_shortfall,
      p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');

    v_pool.balance_units := v_pool.balance_units + v_shortfall;
  END IF;

  -- Debit pool
  UPDATE public.game_wallets
    SET balance_units = v_pool.balance_units - v_return_units, updated_at = now()
    WHERE id = v_pool.id;
  PERFORM public.finance_write_pool_ledger(
    v_pool.id, v_bet.round_id, 'GAME_POOL_DEBIT', -v_return_units,
    v_pool.balance_units, v_pool.balance_units - v_return_units,
    p_bet_id::text || ':payout', p_idempotency_key || ':payout');

  -- Credit player wallet
  UPDATE public.wallets
    SET balance_units = v_player.balance_units + v_return_units, updated_at = now()
    WHERE id = v_bet.wallet_id;
  PERFORM public.finance_write_wallet_ledger(
    v_bet.player_id, v_bet.wallet_id, 'crash', v_bet.round_id,
    'GAME_CASHOUT_CREDIT', v_return_units,
    v_player.balance_units, v_player.balance_units + v_return_units,
    p_bet_id::text || ':payout', p_idempotency_key || ':payout');

  -- Update bet record
  UPDATE public.game_bets
    SET status = 'CASHED_OUT',
        payout = v_return_units,
        profit = v_return_units - v_bet.amount,
        updated_at = now()
    WHERE id = p_bet_id;

  -- Write settlement row
  v_settlement_id := gen_random_uuid();
  INSERT INTO public.game_settlements(
    id, round_id, bet_id, game_key, player_id,
    outcome, stake, profit, payout, idempotency_key)
  VALUES (
    v_settlement_id, v_bet.round_id, p_bet_id, 'crash', v_bet.player_id,
    'CASHED_OUT', v_bet.amount, v_return_units - v_bet.amount,
    v_return_units, p_idempotency_key);

  v_response := jsonb_build_object(
    'bet_id', p_bet_id,
    'return_units', v_return_units,
    'cashout_multiplier', p_cashout_multiplier,
    'idempotent', false);

  INSERT INTO public.idempotency_records(operation, idempotency_key, request_hash, response)
    VALUES ('CRASH_CASHOUT', p_idempotency_key, p_request_hash, v_response);

  RETURN v_response;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Revoke/grant updated functions
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.finance_auto_settle_crash_round(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_auto_settle_crash_round(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.finance_crash_cashout_atomic(uuid,numeric,text,text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_crash_cashout_atomic(uuid,numeric,text,text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill game_wallets for crash if missing
-- ---------------------------------------------------------------------------
INSERT INTO public.game_wallets(game_id, owner_user_id)
  SELECT 'crash', s.owner_user_id FROM public.coin_supply s WHERE s.singleton
  ON CONFLICT (game_id) DO NOTHING;
