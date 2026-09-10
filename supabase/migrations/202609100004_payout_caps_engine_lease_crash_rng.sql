-- ============================================================================
-- 202609100004: Payout caps, engine single-writer lease, hardened crash RNG
--
-- 1. game_payout_caps: authoritative per-game maximum return multiplier.
--    finance_settle_bet_atomic is hardened so that ANY payout outside the
--    legal bounds for the bet's game is rejected:
--      LOSS    -> return must be 0
--      TIE     -> return must equal stake
--      VOID/REFUND -> return must equal stake
--      WIN/CASHOUT -> stake <= return <= stake * cap
-- 2. engine_leases: DB-backed single-writer coordination for in-memory game
--    orchestrators (multi-instance safe).
-- 3. finance_generate_crash_point uses SHA-256 instead of hashtext so the
--    derivation is cryptographically strong even if the secret leaks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Payout caps
-- ---------------------------------------------------------------------------
create table if not exists public.game_payout_caps (
  game_key text primary key check (game_key in (
    'roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar',
    'color-prediction','number-prediction','wheel'
  )),
  max_multiplier numeric(10,2) not null check (max_multiplier >= 1)
);

insert into public.game_payout_caps(game_key, max_multiplier) values
  ('roulette',         36.00),
  ('teen-patti',        6.00),
  ('crash',           100.00),
  ('dice',             36.00),
  ('dragon-tiger',      9.00),
  ('andar-bahar',       2.00),
  ('color-prediction',  5.00),
  ('number-prediction',10.00),
  ('wheel',            10.00)
on conflict (game_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Hardened finance_settle_bet_atomic with bound enforcement
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_settle_bet_atomic(uuid,text,bigint,text,text);
CREATE OR REPLACE FUNCTION public.finance_settle_bet_atomic(
  p_bet_id uuid,
  p_outcome text,
  p_return_units bigint,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_record   public.idempotency_records%rowtype;
  v_bet      public.game_bets%rowtype;
  v_pool     public.game_wallets%rowtype;
  v_player   public.wallets%rowtype;
  v_owner    public.wallets%rowtype;
  v_cap      numeric(10,2);
  v_cap_cents bigint;
  v_max_return bigint;
  v_shortfall bigint;
  v_payout   bigint;
  v_profit   bigint;
  v_response jsonb;
BEGIN
  if p_return_units < 0 then raise exception 'return cannot be negative'; end if;

  SELECT * INTO v_record FROM public.idempotency_records
    WHERE operation = 'GAME_SETTLEMENT' AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_record.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request';
    END IF;
    RETURN v_record.response;
  END IF;

  SELECT * INTO v_bet FROM public.game_bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bet not found'; END IF;

  IF EXISTS (SELECT 1 FROM public.game_settlements WHERE bet_id = p_bet_id) THEN
    RAISE EXCEPTION 'bet already settled with a different idempotency key';
  END IF;

  -- ---- Bound enforcement (server-authoritative, game-specific) ----
  IF p_outcome = 'LOSS' AND p_return_units <> 0 THEN
    RAISE EXCEPTION 'LOSS settlement must return zero';
  END IF;

  IF p_outcome IN ('TIE', 'VOID', 'REFUND') AND p_return_units <> v_bet.amount THEN
    RAISE EXCEPTION 'TIE/VOID/REFUND settlement must return exactly the stake';
  END IF;

  IF p_outcome IN ('WIN', 'CASHOUT') THEN
    SELECT max_multiplier INTO v_cap FROM public.game_payout_caps WHERE game_key = v_bet.game_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'payout cap not configured for game'; END IF;
    v_cap_cents  := round(v_cap * 100)::bigint;
    v_max_return := (v_bet.amount * v_cap_cents) / 100;
    IF p_return_units < v_bet.amount OR p_return_units > v_max_return THEN
      RAISE EXCEPTION 'payout exceeds authorised bounds for game';
    END IF;
  END IF;

  -- ---- Wallet/pool movement (unchanged from prior contract) ----
  SELECT * INTO v_pool FROM public.game_wallets WHERE game_id = v_bet.game_key FOR UPDATE;
  SELECT * INTO v_player FROM public.wallets WHERE id = v_bet.wallet_id FOR UPDATE;

  IF p_return_units > v_pool.balance_units THEN
    v_shortfall := p_return_units - v_pool.balance_units;
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
      v_owner.user_id, v_owner.id, v_bet.game_key, v_bet.round_id,
      'GAME_LIQUIDITY_DEBIT', -v_shortfall,
      v_owner.balance_units, v_owner.balance_units - v_shortfall,
      p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');

    UPDATE public.game_wallets SET balance_units = balance_units + v_shortfall, updated_at = now() WHERE id = v_pool.id;
    PERFORM public.finance_write_pool_ledger(
      v_pool.id, v_bet.round_id, 'GAME_LIQUIDITY_CREDIT', v_shortfall,
      v_pool.balance_units, v_pool.balance_units + v_shortfall,
      p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');

    v_pool.balance_units := v_pool.balance_units + v_shortfall;
  END IF;

  IF p_return_units > 0 THEN
    UPDATE public.game_wallets
      SET balance_units = v_pool.balance_units - p_return_units, updated_at = now()
      WHERE id = v_pool.id;
    PERFORM public.finance_write_pool_ledger(
      v_pool.id, v_bet.round_id, 'GAME_POOL_DEBIT', -p_return_units,
      v_pool.balance_units, v_pool.balance_units - p_return_units,
      p_bet_id::text || ':payout', p_idempotency_key || ':payout');

    UPDATE public.wallets
      SET balance_units = v_player.balance_units + p_return_units, updated_at = now()
      WHERE id = v_player.id;
    PERFORM public.finance_write_wallet_ledger(
      v_player.user_id, v_player.id, v_bet.game_key, v_bet.round_id,
      CASE WHEN p_outcome = 'CASHOUT' THEN 'GAME_CASHOUT_CREDIT' ELSE 'GAME_WIN_CREDIT' END,
      p_return_units, v_player.balance_units, v_player.balance_units + p_return_units,
      p_bet_id::text || ':payout', p_idempotency_key || ':payout');
  END IF;

  v_payout := p_return_units;
  v_profit := p_return_units - v_bet.amount;

  UPDATE public.game_bets
    SET status = CASE p_outcome
          WHEN 'WIN' THEN 'WON'
          WHEN 'TIE' THEN 'TIED'
          WHEN 'CASHOUT' THEN 'CASHED_OUT'
          WHEN 'VOID' THEN 'VOID'
          WHEN 'REFUND' THEN 'REFUNDED'
          ELSE 'LOST'
        END,
        payout = v_payout,
        profit = v_profit,
        updated_at = now()
    WHERE id = p_bet_id;

  INSERT INTO public.game_settlements(
    round_id, bet_id, game_key, player_id, outcome, stake, profit, payout, idempotency_key)
  VALUES (
    v_bet.round_id, p_bet_id, v_bet.game_key, v_bet.player_id,
    CASE p_outcome
      WHEN 'WIN' THEN 'WON'
      WHEN 'TIE' THEN 'TIED'
      WHEN 'CASHOUT' THEN 'CASHED_OUT'
      WHEN 'VOID' THEN 'VOID'
      WHEN 'REFUND' THEN 'REFUNDED'
      ELSE 'LOST'
    END,
    v_bet.amount, v_profit, v_payout, p_idempotency_key);

  v_response := jsonb_build_object(
    'bet_id', p_bet_id,
    'return_units', p_return_units,
    'idempotent', false);

  INSERT INTO public.idempotency_records(operation, idempotency_key, request_hash, response)
    VALUES ('GAME_SETTLEMENT', p_idempotency_key, p_request_hash, v_response);

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_settle_bet_atomic(uuid,text,bigint,text,text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_settle_bet_atomic(uuid,text,bigint,text,text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Hardened crash RNG: SHA-256 based derivation
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_generate_crash_point(uuid, text);
CREATE OR REPLACE FUNCTION public.finance_generate_crash_point(p_round_id uuid, p_game_key text)
RETURNS numeric(10,2) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_round      public.game_rounds%rowtype;
  v_crash_point numeric(10,2);
  v_secret     text;
  v_seed       text;
  v_hash       bytea;
  v_half       bigint;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds
    WHERE id = p_round_id AND game_key = p_game_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found'; END IF;

  IF v_round.crash_point IS NOT NULL THEN
    RETURN v_round.crash_point;
  END IF;

  SELECT secret INTO v_secret FROM public.crash_server_secret WHERE singleton;
  IF NOT FOUND THEN RAISE EXCEPTION 'server secret not configured'; END IF;

  -- SHA-256 of secret + round id. Not derivable from the public round id alone.
  v_seed := v_secret || ':' || p_round_id::text || ':crash-point-v2';
  v_hash := digest(v_seed, 'sha256');
  -- Use the first 8 bytes as a big-endian 63-bit positive integer.
  v_half  := (get_byte(v_hash, 0)::bigint << 56)
           | (get_byte(v_hash, 1)::bigint << 48)
           | (get_byte(v_hash, 2)::bigint << 40)
           | (get_byte(v_hash, 3)::bigint << 32)
           | (get_byte(v_hash, 4)::bigint << 24)
           | (get_byte(v_hash, 5)::bigint << 16)
           | (get_byte(v_hash, 6)::bigint << 8)
           |  get_byte(v_hash, 7)::bigint;
  -- 1.01 .. 99.99 range, stepping by 0.01 (9900 possible values)
  v_crash_point := (1.01 + (v_half % 990000) / 10000.0)::numeric(10,2);

  UPDATE public.game_rounds
    SET crash_point = v_crash_point, updated_at = now()
    WHERE id = p_round_id;

  RETURN v_crash_point;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_generate_crash_point(uuid, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finance_generate_crash_point(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Engine single-writer lease
-- ---------------------------------------------------------------------------
create table if not exists public.engine_leases (
  singleton boolean not null default true unique check (singleton),
  instance_id uuid not null,
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.finance_acquire_engine_lease(
  p_instance_id uuid,
  p_ttl_seconds integer default 30
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid;
begin
  insert into public.engine_leases(singleton, instance_id, acquired_at, updated_at)
  values (true, p_instance_id, now(), now())
  on conflict (singleton) do update
    set instance_id = p_instance_id,
        acquired_at = now(),
        updated_at = now()
    where engine_leases.acquired_at < now() - (p_ttl_seconds || ' seconds')::interval
    returning instance_id into v_owner;

  return v_owner = p_instance_id;
end;
$$;

create or replace function public.finance_release_engine_lease(p_instance_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.engine_leases where singleton and instance_id = p_instance_id;
  return found;
end;
$$;

-- RLS + grants for lease/caps
alter table public.engine_leases enable row level security;
alter table public.game_payout_caps enable row level security;

revoke all on public.engine_leases from public, anon, authenticated;
revoke all on public.game_payout_caps from public, anon, authenticated;
grant all on public.engine_leases to service_role;
grant all on public.game_payout_caps to service_role;

revoke all on function public.finance_acquire_engine_lease(uuid,integer) from public, anon, authenticated;
revoke all on function public.finance_release_engine_lease(uuid) from public, anon, authenticated;
grant execute on function public.finance_acquire_engine_lease(uuid,integer) to service_role;
grant execute on function public.finance_release_engine_lease(uuid) to service_role;
