-- ============================================================================
-- 202609090001: Crash recovery, constraints, and wallet auto-creation
--
-- This migration adds:
-- 1. Crash-specific round state columns for recovery
-- 2. Unique constraint: one bet per player per Crash round
-- 3. Wallet auto-creation trigger
-- 4. Advisory lock functions for single-writer round progression
-- 5. Crash point persisted before RUNNING
-- 6. Recovery state tracking
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add crash-specific columns to game_rounds for persistent recovery
-- ---------------------------------------------------------------------------
alter table public.game_rounds
  add column if not exists crash_point numeric(10,2),
  add column if not exists current_multiplier numeric(10,2) default 1.00,
  add column if not exists locked_at timestamptz,
  add column if not exists running_at timestamptz,
  add column if not exists crashed_at timestamptz,
  add column if not exists result_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Ensure crash_point is not exposed to clients (RLS handles this)
comment on column public.game_rounds.crash_point IS 'Server-authoritative crash point. Never exposed to clients before crash.';

-- ---------------------------------------------------------------------------
-- 2. One bet per player per Crash round (business rule enforcement)
-- ---------------------------------------------------------------------------
create unique index if not exists game_bets_crash_unique_player_round
  on public.game_bets (round_id, player_id)
  where game_key = 'crash';

-- ---------------------------------------------------------------------------
-- 3. Wallet auto-creation on user profile insert
-- ---------------------------------------------------------------------------
create or replace function public.ensure_wallet_for_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_wallet public.wallets%rowtype;
  v_wallet_id text;
begin
  -- Generate deterministic wallet_id from user id
  v_wallet_id := 'WAL-' || replace(new.id::text, '-', '') || '-' || floor(extract(epoch from now()))::text;
  v_wallet_id := upper(substring(v_wallet_id from 1 for 32));

  insert into public.wallets(wallet_id, user_id, balance, balance_units, version)
  values (v_wallet_id, new.id, 0, 0, 1)
  on conflict (user_id) do nothing
  returning * into v_wallet;

  if not found then
    select * into v_wallet from public.wallets where user_id = new.id;
  end if;

  -- Create opening ledger entry if wallet was just created
  if v_wallet.balance_units = 0 then
    insert into public.wallet_transactions(wallet_id, player_id, transaction_type, amount, balance_before, balance_after, reference_key, idempotency_key)
    values (v_wallet.id, new.id, 'MIGRATION_OPENING_ALLOCATION', 0, 0, 0, 'wallet-creation-' || new.id::text, 'wallet-creation-' || new.id::text)
    on conflict (reference_key, transaction_type, wallet_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_ensure_wallet on public.users;
create trigger trigger_ensure_wallet
after insert on public.users
for each row execute function public.ensure_wallet_for_user();

-- Backfill wallets for existing users who don't have one
do $$
declare v_user public.users%rowtype;
begin
  for v_user in select * from public.users where not exists (select 1 from public.wallets where user_id = users.id) loop
    perform public.ensure_wallet_for_user() from (select v_user.*) as new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Advisory lock functions for single-writer coordination
-- ---------------------------------------------------------------------------
create or replace function public.finance_acquire_round_lock(p_round_id uuid, p_game_key text, p_action text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lock_key bigint;
begin
  -- Generate deterministic lock key from round_id
  v_lock_key := ('x' || substring(md5(p_round_id::text) from 1 for 15))::bit(60)::bigint;

  -- Try to acquire advisory lock (non-blocking)
  if pg_try_advisory_xact_lock(v_lock_key) then
    -- Verify round still exists and matches
    if exists (select 1 from public.game_rounds where id = p_round_id and game_key = p_game_key) then
      return true;
    else
      -- Release lock if round doesn't match
      perform pg_advisory_xact_unlock(v_lock_key);
      return false;
    end if;
  end if;
  return false;
end;
$$;

create or replace function public.finance_release_round_lock(p_round_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lock_key bigint;
begin
  v_lock_key := ('x' || substring(md5(p_round_id::text) from 1 for 15))::bit(60)::bigint;
  perform pg_advisory_xact_unlock(v_lock_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Crash round recovery state machine
-- ---------------------------------------------------------------------------
create type public.crash_recovery_state as enum (
  'NONE',
  'BETTING_RECOVERY',
  'LOCK_RECOVERY',
  'RUNNING_RECOVERY',
  'CRASH_RECOVERY',
  'RESULT_RECOVERY',
  'COMPLETED'
);

alter table public.game_rounds
  add column if not exists recovery_state public.crash_recovery_state default 'NONE';

-- ---------------------------------------------------------------------------
-- 6. Deterministic crash point generation (persisted before RUNNING)
-- ---------------------------------------------------------------------------
create or replace function public.finance_generate_crash_point(p_round_id uuid, p_game_key text)
returns numeric(10,2) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_round public.game_rounds%rowtype;
  v_crash_point numeric(10,2);
  v_seed text;
begin
  select * into v_round from public.game_rounds where id = p_round_id and game_key = p_game_key for update;
  if not found then raise exception 'round not found'; end if;

  if v_round.crash_point is not null then
    return v_round.crash_point;
  end if;

  -- Generate deterministic crash point using round_id as seed
  -- This ensures the same crash point is generated on recovery
  v_seed := p_round_id::text || 'crash-point-seed-v1';
  v_crash_point := (
    1.01 + (abs(hashtext(v_seed)) % 9900) / 100.0
  )::numeric(10,2);

  update public.game_rounds
  set crash_point = v_crash_point,
      updated_at = now()
  where id = p_round_id;

  return v_crash_point;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Round recovery function - reconstructs authoritative state from DB
-- ---------------------------------------------------------------------------
create or replace function public.finance_recover_crash_round(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_round public.game_rounds%rowtype;
  v_bets public.game_bets[];
  v_settlements public.game_settlements[];
  v_status text;
  v_recovery_state public.crash_recovery_state;
begin
  select * into v_round from public.game_rounds where id = p_round_id and game_key = 'crash';
  if not found then raise exception 'crash round not found'; end if;

  -- Get all bets for this round
  select array_agg(b) into v_bets from (
    select * from public.game_bets where round_id = p_round_id and game_key = 'crash' order by created_at
  ) b;

  -- Get all settlements for this round
  select array_agg(s) into v_settlements from (
    select * from public.game_settlements where round_id = p_round_id and game_key = 'crash' order by settled_at
  ) s;

  -- Determine recovery state based on DB state
  if v_round.status = 'BETTING' then
    v_recovery_state := 'BETTING_RECOVERY';
  elsif v_round.status = 'LOCK' then
    v_recovery_state := 'LOCK_RECOVERY';
  elsif v_round.status = 'RUNNING' then
    v_recovery_state := 'RUNNING_RECOVERY';
  elsif v_round.status = 'CRASH' then
    v_recovery_state := 'CRASH_RECOVERY';
  elsif v_round.status = 'RESULT' then
    v_recovery_state := 'RESULT_RECOVERY';
  elsif v_round.status = 'COMPLETED' then
    v_recovery_state := 'COMPLETED';
  else
    v_recovery_state := 'NONE';
  end if;

  update public.game_rounds
  set recovery_state = v_recovery_state,
      updated_at = now()
  where id = p_round_id;

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_number', v_round.round_number,
    'status', v_round.status,
    'recovery_state', v_recovery_state,
    'crash_point', v_round.crash_point,
    'current_multiplier', v_round.current_multiplier,
    'betting_ends_at', v_round.betting_ends_at,
    'locked_at', v_round.locked_at,
    'running_at', v_round.running_at,
    'crashed_at', v_round.crashed_at,
    'result_at', v_round.result_at,
    'completed_at', v_round.completed_at,
    'bets', coalesce(v_bets, '{}'),
    'settlements', coalesce(v_settlements, '{}'),
    'result_data', v_round.result_data
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Mark interrupted rounds with proper recovery state
-- ---------------------------------------------------------------------------
create or replace function public.finance_mark_interrupted_rounds_for_recovery()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
  v_round public.game_rounds%rowtype;
begin
  -- Mark rounds that have no result and are not completed
  update public.game_rounds
  set status = 'RECOVERY_REQUIRED',
      recovery_state = case
        when status = 'BETTING' then 'BETTING_RECOVERY'::public.crash_recovery_state
        when status = 'LOCK' then 'LOCK_RECOVERY'::public.crash_recovery_state
        when status = 'RUNNING' then 'RUNNING_RECOVERY'::public.crash_recovery_state
        when status = 'CRASH' then 'CRASH_RECOVERY'::public.crash_recovery_state
        when status = 'RESULT' then 'RESULT_RECOVERY'::public.crash_recovery_state
        else 'NONE'::public.crash_recovery_state
      end,
      updated_at = now()
  where status not in ('COMPLETED', 'RECOVERY_REQUIRED', 'CANCELLED')
    and result_data is null
    and game_key = 'crash';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Crash-specific bet placement with all recovery data
-- ---------------------------------------------------------------------------
create or replace function public.finance_place_crash_bet_atomic(
  p_bet_id uuid,
  p_player_id uuid,
  p_round_id uuid,
  p_amount bigint,
  p_auto_cashout_multiplier numeric(10,2) default null,
  p_idempotency_key text,
  p_request_hash text,
  p_wallet_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_record public.idempotency_records%rowtype;
  v_wallet public.wallets%rowtype;
  v_round public.game_rounds%rowtype;
  v_pool public.game_wallets%rowtype;
  v_owner uuid;
  v_response jsonb;
  v_bet_data jsonb;
begin
  if p_amount <= 0 or p_amount % 10 <> 0 then
    raise exception 'amount must be positive whole displayed tokens in deci-token units';
  end if;

  if p_auto_cashout_multiplier is not null and p_auto_cashout_multiplier < 1.01 then
    raise exception 'auto cashout multiplier must be at least 1.01';
  end if;

  select * into v_record
  from public.idempotency_records
  where operation = 'CRASH_BET' and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_record.request_hash <> p_request_hash then
      raise exception 'idempotency key reused with a different request';
    end if;
    return v_record.response;
  end if;

  select * into v_round
  from public.game_rounds
  where id = p_round_id and game_key = 'crash'
  for update;

  if not found then raise exception 'round not found'; end if;
  if v_round.status <> 'BETTING' then raise exception 'betting is closed'; end if;
  if v_round.betting_ends_at is not null and v_round.betting_ends_at <= now() then
    raise exception 'betting period has ended';
  end if;

  if not exists (select 1 from public.users where id = p_player_id and role = 'PLAYER' and status = 'ACTIVE') then
    raise exception 'active PLAYER required';
  end if;

  if p_wallet_id is null then
    select * into v_wallet from public.wallets where user_id = p_player_id for update;
  else
    select * into v_wallet from public.wallets where id = p_wallet_id and user_id = p_player_id for update;
  end if;

  if not found or v_wallet.balance_units < p_amount then
    raise exception 'insufficient wallet balance';
  end if;

  select owner_user_id into v_owner from public.coin_supply where singleton;
  insert into public.game_wallets(game_id, owner_user_id) values ('crash', v_owner) on conflict (game_id) do nothing;
  select * into v_pool from public.game_wallets where game_id = 'crash' for update;

  update public.wallets set balance_units = v_wallet.balance_units - p_amount, updated_at = now() where id = v_wallet.id;
  perform public.finance_write_wallet_ledger(p_player_id, v_wallet.id, 'crash', p_round_id, 'GAME_BET_DEBIT', -p_amount, v_wallet.balance_units, v_wallet.balance_units - p_amount, p_bet_id::text, p_idempotency_key);

  update public.game_wallets set balance_units = v_pool.balance_units + p_amount, updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, p_round_id, 'GAME_POOL_CREDIT', p_amount, v_pool.balance_units, v_pool.balance_units + p_amount, p_bet_id::text, p_idempotency_key);

  v_bet_data := jsonb_build_object(
    'autoCashoutMultiplier', p_auto_cashout_multiplier
  );

  insert into public.game_bets(id, round_id, game_key, player_id, wallet_id, amount, bet_data, idempotency_key)
  values (p_bet_id, p_round_id, 'crash', p_player_id, v_wallet.id, p_amount, v_bet_data, p_idempotency_key);

  v_response := jsonb_build_object('bet_id', p_bet_id, 'round_id', p_round_id, 'amount', p_amount, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response)
  values ('CRASH_BET', p_idempotency_key, p_request_hash, v_response);

  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Crash-specific cashout with exactly-once guarantee
-- ---------------------------------------------------------------------------
create or replace function public.finance_crash_cashout_atomic(
  p_bet_id uuid,
  p_cashout_multiplier numeric(10,2),
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_record public.idempotency_records%rowtype;
  v_bet public.game_bets%rowtype;
  v_round public.game_rounds%rowtype;
  v_pool public.game_wallets%rowtype;
  v_player public.wallets%rowtype;
  v_owner public.wallets%rowtype;
  v_shortfall bigint;
  v_return_units bigint;
  v_payout bigint;
  v_profit bigint;
  v_response jsonb;
  v_settlement_id uuid;
begin
  -- Deterministic idempotency key for cashout based on bet_id
  -- This ensures same logical cashout = same idempotency key
  if not exists (select 1 from public.idempotency_records where operation = 'CRASH_CASHOUT' and idempotency_key = p_idempotency_key) then
    -- First attempt - use provided key
  elsif (select request_hash from public.idempotency_records where operation = 'CRASH_CASHOUT' and idempotency_key = p_idempotency_key) <> p_request_hash then
    raise exception 'idempotency key reused with a different request';
  else
    -- Idempotent replay - return cached response
    return (select response from public.idempotency_records where operation = 'CRASH_CASHOUT' and idempotency_key = p_idempotency_key);
  end if;

  select * into v_bet from public.game_bets where id = p_bet_id and game_key = 'crash' for update;
  if not found then raise exception 'bet not found'; end if;

  select * into v_round from public.game_rounds where id = v_bet.round_id and game_key = 'crash' for update;
  if not found then raise exception 'round not found'; end if;

  -- Verify cashout is allowed: round must be RUNNING and multiplier <= current
  if v_round.status <> 'RUNNING' then
    raise exception 'cashout only allowed during RUNNING phase';
  end if;

  if v_round.current_multiplier is null or p_cashout_multiplier > v_round.current_multiplier then
    raise exception 'cashout multiplier exceeds current multiplier';
  end if;

  -- Check if already settled
  if exists (select 1 from public.game_settlements where bet_id = p_bet_id) then
    raise exception 'bet already settled';
  end if;

  if v_bet.status = 'CASHED_OUT' or v_bet.status = 'WON' or v_bet.status = 'LOST' then
    raise exception 'bet already settled';
  end if;

  -- Calculate return
  v_return_units := (v_bet.amount * p_cashout_multiplier * 10)::bigint / 10; -- amount is in deci-tokens, multiplier has 2 decimals
  -- Actually: bet.amount is already in deci-tokens (units), multiplier is 1.50 -> return = amount * 1.50
  v_return_units := (v_bet.amount * p_cashout_multiplier)::bigint;

  -- Settle using existing atomic settlement logic
  select * into v_pool from public.game_wallets where game_id = 'crash' for update;
  select * into v_player from public.wallets where id = v_bet.wallet_id for update;

  if v_return_units > v_pool.balance_units then
    v_shortfall := v_return_units - v_pool.balance_units;
    select w.* into v_owner from public.wallets w join public.coin_supply s on s.owner_user_id = w.user_id where s.singleton for update;
    if not found or v_owner.balance_units < v_shortfall then raise exception 'insufficient owner game liquidity'; end if;
    update public.wallets set balance_units = v_owner.balance_units - v_shortfall, updated_at = now() where id = v_owner.id;
    perform public.finance_write_wallet_ledger(v_owner.user_id, v_owner.id, 'crash', v_bet.round_id, 'GAME_LIQUIDITY_DEBIT', -v_shortfall, v_owner.balance_units, v_owner.balance_units - v_shortfall, p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');
    update public.game_wallets set balance_units = v_pool.balance_units + v_shortfall, updated_at = now() where id = v_pool.id;
    perform public.finance_write_pool_ledger(v_pool.id, v_bet.round_id, 'GAME_LIQUIDITY_CREDIT', v_shortfall, v_pool.balance_units, v_pool.balance_units + v_shortfall, p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');
    v_pool.balance_units := v_pool.balance_units + v_shortfall;
  end if;

  update public.game_wallets set balance_units = v_pool.balance_units - v_return_units, updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, v_bet.round_id, 'GAME_POOL_DEBIT', -v_return_units, v_pool.balance_units, v_pool.balance_units - v_return_units, p_bet_id::text || ':payout', p_idempotency_key || ':payout');

  update public.wallets set balance_units = v_player.balance_units + v_return_units, updated_at = now() where id = v_player.id;
  perform public.finance_write_wallet_ledger(v_player.user_id, v_player.id, 'crash', v_bet.round_id, 'GAME_CASHOUT_CREDIT', v_return_units, v_player.balance_units, v_player.balance_units + v_return_units, p_bet_id::text || ':payout', p_idempotency_key || ':payout');

  v_payout := v_return_units;
  v_profit := v_return_units - v_bet.amount;

  update public.game_bets
  set status = 'CASHED_OUT', payout = v_payout, profit = v_profit, updated_at = now()
  where id = p_bet_id;

  v_settlement_id := gen_random_uuid();
  insert into public.game_settlements(id, round_id, bet_id, game_key, player_id, outcome, stake, profit, payout, idempotency_key)
  values (v_settlement_id, v_bet.round_id, p_bet_id, 'crash', v_bet.player_id, 'CASHED_OUT', v_bet.amount, v_profit, v_payout, p_idempotency_key);

  v_response := jsonb_build_object('bet_id', p_bet_id, 'return_units', v_return_units, 'cashout_multiplier', p_cashout_multiplier, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response)
  values ('CRASH_CASHOUT', p_idempotency_key, p_request_hash, v_response);

  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Crash round state progression with advisory lock
-- ---------------------------------------------------------------------------
create or replace function public.finance_advance_crash_round(
  p_round_id uuid,
  p_new_status text,
  p_current_multiplier numeric(10,2) default null,
  p_crashed_at timestamptz default null,
  p_result_data jsonb default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_round public.game_rounds%rowtype;
  v_locked boolean;
begin
  -- Acquire advisory lock for single-writer
  v_locked := public.finance_acquire_round_lock(p_round_id, 'crash', p_new_status);
  if not v_locked then
    raise exception 'could not acquire round lock; another instance is processing this round';
  end if;

  select * into v_round from public.game_rounds where id = p_round_id and game_key = 'crash' for update;
  if not found then raise exception 'round not found'; end if;

  -- Validate state transitions
  if v_round.status = 'BETTING' and p_new_status = 'LOCK' then
    update public.game_rounds set status = 'LOCK', locked_at = now(), updated_at = now() where id = p_round_id;
  elsif v_round.status = 'LOCK' and p_new_status = 'RUNNING' then
    -- Generate crash point if not already generated
    if v_round.crash_point is null then
      perform public.finance_generate_crash_point(p_round_id, 'crash');
    end if;
    update public.game_rounds set status = 'RUNNING', running_at = now(), current_multiplier = 1.00, updated_at = now() where id = p_round_id;
  elsif v_round.status = 'RUNNING' and p_new_status = 'RUNNING' then
    -- Multiplier update
    update public.game_rounds set current_multiplier = p_current_multiplier, updated_at = now() where id = p_round_id;
  elsif v_round.status = 'RUNNING' and p_new_status = 'CRASH' then
    update public.game_rounds
    set status = 'CRASH', crashed_at = coalesce(p_crashed_at, now()), current_multiplier = v_round.crash_point, result_data = p_result_data, updated_at = now()
    where id = p_round_id;
  elsif v_round.status = 'CRASH' and p_new_status = 'RESULT' then
    update public.game_rounds set status = 'RESULT', result_at = now(), result_data = coalesce(v_round.result_data, p_result_data), updated_at = now() where id = p_round_id;
  elsif v_round.status = 'RESULT' and p_new_status = 'COMPLETED' then
    update public.game_rounds set status = 'COMPLETED', completed_at = now(), recovery_state = 'COMPLETED', updated_at = now() where id = p_round_id;
  else
    raise exception 'invalid state transition: % -> %', v_round.status, p_new_status;
  end if;

  select * into v_round from public.game_rounds where id = p_round_id;
  return jsonb_build_object('round_id', v_round.id, 'status', v_round.status, 'current_multiplier', v_round.current_multiplier);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Auto-settle remaining bets on crash (for recovery)
-- ---------------------------------------------------------------------------
create or replace function public.finance_auto_settle_crash_round(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_round public.game_rounds%rowtype;
  v_bet public.game_bets%rowtype;
  v_pool public.game_wallets%rowtype;
  v_player public.wallets%rowtype;
  v_owner public.wallets%rowtype;
  v_shortfall bigint;
  v_settled_count integer := 0;
  v_settlement_id uuid;
  v_response jsonb;
  v_idempotency_key text;
begin
  select * into v_round from public.game_rounds where id = p_round_id and game_key = 'crash' for update;
  if not found then raise exception 'round not found'; end if;

  if v_round.status <> 'CRASH' and v_round.status <> 'RESULT' then
    raise exception 'round must be in CRASH or RESULT state for auto-settlement';
  end if;

  if v_round.crash_point is null then
    raise exception 'crash point not set';
  end if;

  select * into v_pool from public.game_wallets where game_id = 'crash' for update;

  for v_bet in select * from public.game_bets where round_id = p_round_id and game_key = 'crash' and status in ('PLACED', 'ACTIVE') loop
    -- Check if already settled
    if exists (select 1 from public.game_settlements where bet_id = v_bet.id) then
      continue;
    end if;

    -- Check if auto-cashout would have triggered
    if v_bet.bet_data ? 'autoCashoutMultiplier' then
      if (v_bet.bet_data->>'autoCashoutMultiplier')::numeric <= v_round.crash_point then
        -- Auto-cashout would have triggered - settle as CASHED_OUT
        continue; -- This should have been handled by the engine before crash
      end if;
    end if;

    -- No auto-cashout or auto-cashout > crash point -> LOSS
    v_idempotency_key := 'crash-auto-settle:' || p_round_id::text || ':' || v_bet.id::text;

    select * into v_record from public.idempotency_records where operation = 'CRASH_AUTO_SETTLE' and idempotency_key = v_idempotency_key for update;
    if found then continue; end if;

    select * into v_player from public.wallets where id = v_bet.wallet_id for update;

    v_settlement_id := gen_random_uuid();
    insert into public.game_settlements(id, round_id, bet_id, game_key, player_id, outcome, stake, profit, payout, idempotency_key)
    values (v_settlement_id, v_bet.round_id, v_bet.id, 'crash', v_bet.player_id, 'LOST', v_bet.amount, -v_bet.amount, 0, v_idempotency_key);

    update public.game_bets set status = 'LOST', profit = -v_bet.amount, payout = 0, updated_at = now() where id = v_bet.id;

    insert into public.idempotency_records(operation, idempotency_key, request_hash, response)
    values ('CRASH_AUTO_SETTLE', v_idempotency_key, v_idempotency_key, jsonb_build_object('bet_id', v_bet.id, 'settled', true));

    v_settled_count := v_settled_count + 1;
  end loop;

  return jsonb_build_object('round_id', p_round_id, 'auto_settled_count', v_settled_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Grant execute permissions
-- ---------------------------------------------------------------------------
revoke all on function public.finance_acquire_round_lock(uuid,text,text) from public, anon, authenticated;
revoke all on function public.finance_release_round_lock(uuid) from public, anon, authenticated;
revoke all on function public.finance_generate_crash_point(uuid,text) from public, anon, authenticated;
revoke all on function public.finance_recover_crash_round(uuid) from public, anon, authenticated;
revoke all on function public.finance_mark_interrupted_rounds_for_recovery() from public, anon, authenticated;
revoke all on function public.finance_place_crash_bet_atomic(uuid,uuid,uuid,bigint,numeric,text,text,uuid) from public, anon, authenticated;
revoke all on function public.finance_crash_cashout_atomic(uuid,numeric,text,text) from public, anon, authenticated;
revoke all on function public.finance_advance_crash_round(uuid,text,numeric,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.finance_auto_settle_crash_round(uuid) from public, anon, authenticated;

grant execute on function public.finance_acquire_round_lock(uuid,text,text) to service_role;
grant execute on function public.finance_release_round_lock(uuid) to service_role;
grant execute on function public.finance_generate_crash_point(uuid,text) to service_role;
grant execute on function public.finance_recover_crash_round(uuid) to service_role;
grant execute on function public.finance_mark_interrupted_rounds_for_recovery() to service_role;
grant execute on function public.finance_place_crash_bet_atomic(uuid,uuid,uuid,bigint,numeric,text,text,uuid) to service_role;
grant execute on function public.finance_crash_cashout_atomic(uuid,numeric,text,text) to service_role;
grant execute on function public.finance_advance_crash_round(uuid,text,numeric,timestamptz,jsonb) to service_role;
grant execute on function public.finance_auto_settle_crash_round(uuid) to service_role;

grant execute on function public.ensure_wallet_for_user() to service_role;
