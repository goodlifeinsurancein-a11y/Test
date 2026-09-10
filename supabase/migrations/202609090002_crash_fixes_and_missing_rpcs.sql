-- ============================================================================
-- 202609090002: Fix crash point generation, auto-settle, and add missing RPCs
--
-- Fixes:
-- 1. Crash point generation uses server-side secret (not derivable from round_id)
-- 2. Auto-settle properly handles auto-cashout bets on recovery
-- 3. Add missing create_user_profile / create_user_wallet RPCs
-- 4. Fix financial roulette RPC parameter names and game_key casing
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Server-side crash point secret (never exposed to clients)
-- ---------------------------------------------------------------------------
-- Create a server-side secret for crash point generation
create table if not exists public.crash_server_secret (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

-- Only service_role can read the secret
alter table public.crash_server_secret enable row level security;
revoke all on public.crash_server_secret from public, anon, authenticated;
grant all on public.crash_server_secret to service_role;

-- Insert initial secret if not exists
insert into public.crash_server_secret (singleton, secret)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fix crash point generation to use server secret + round_id
-- ---------------------------------------------------------------------------
drop function if exists public.finance_generate_crash_point(uuid, text);
create or replace function public.finance_generate_crash_point(p_round_id uuid, p_game_key text)
returns numeric(10,2) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_round public.game_rounds%rowtype;
  v_crash_point numeric(10,2);
  v_secret text;
  v_seed text;
begin
  select * into v_round from public.game_rounds where id = p_round_id and game_key = p_game_key for update;
  if not found then raise exception 'round not found'; end if;

  if v_round.crash_point is not null then
    return v_round.crash_point;
  end if;

  -- Get server-side secret (never exposed to clients)
  select secret into v_secret from public.crash_server_secret where singleton;
  if not found then raise exception 'server secret not configured'; end if;

  -- Generate crash point using server secret + round_id as seed
  -- This ensures: same round_id always produces same crash_point on recovery,
  -- but crash_point is NOT derivable from public round_id alone.
  v_seed := v_secret || ':' || p_round_id::text || ':crash-point-v1';
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
-- 3. Fix auto-settle to properly handle auto-cashout bets on recovery
-- ---------------------------------------------------------------------------
drop function if exists public.finance_auto_settle_crash_round(uuid);
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
  v_return_units bigint;
  v_payout bigint;
  v_profit bigint;
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
    v_idempotency_key := 'crash-auto-settle:' || p_round_id::text || ':' || v_bet.id::text;

    select * into v_player from public.wallets where id = v_bet.wallet_id for update;

    if v_bet.bet_data ? 'autoCashoutMultiplier' then
      if (v_bet.bet_data->>'autoCashoutMultiplier')::numeric <= v_round.crash_point then
        -- Auto-cashout would have triggered - settle as CASHED_OUT
        v_return_units := (v_bet.amount * (v_bet.bet_data->>'autoCashoutMultiplier')::numeric)::bigint;
        v_payout := v_return_units;
        v_profit := v_return_units - v_bet.amount;

        -- Ensure pool has liquidity
        if v_return_units > v_pool.balance_units then
          v_shortfall := v_return_units - v_pool.balance_units;
          select w.* into v_owner from public.wallets w join public.coin_supply s on s.owner_user_id = w.user_id where s.singleton for update;
          if not found or v_owner.balance_units < v_shortfall then raise exception 'insufficient owner game liquidity'; end if;
          update public.wallets set balance_units = v_owner.balance_units - v_shortfall, updated_at = now() where id = v_owner.id;
          perform public.finance_write_wallet_ledger(v_owner.user_id, v_owner.id, 'crash', v_bet.round_id, 'GAME_LIQUIDITY_DEBIT', -v_shortfall, v_owner.balance_units, v_owner.balance_units - v_shortfall, v_bet.id::text || ':liquidity', v_idempotency_key || ':liquidity');
          update public.game_wallets set balance_units = v_pool.balance_units + v_shortfall, updated_at = now() where id = v_pool.id;
          perform public.finance_write_pool_ledger(v_pool.id, v_bet.round_id, 'GAME_LIQUIDITY_CREDIT', v_shortfall, v_pool.balance_units, v_pool.balance_units + v_shortfall, v_bet.id::text || ':liquidity', v_idempotency_key || ':liquidity');
          v_pool.balance_units := v_pool.balance_units + v_shortfall;
        end if;

        -- Pay out from pool
        update public.game_wallets set balance_units = v_pool.balance_units - v_return_units, updated_at = now() where id = v_pool.id;
        perform public.finance_write_pool_ledger(v_pool.id, v_bet.round_id, 'GAME_POOL_DEBIT', -v_return_units, v_pool.balance_units, v_pool.balance_units - v_return_units, v_bet.id::text || ':payout', v_idempotency_key || ':payout');

        -- Credit player
        update public.wallets set balance_units = v_player.balance_units + v_return_units, updated_at = now() where id = v_player.id;
        perform public.finance_write_wallet_ledger(v_player.user_id, v_player.id, 'crash', v_bet.round_id, 'GAME_CASHOUT_CREDIT', v_return_units, v_player.balance_units, v_player.balance_units + v_return_units, v_bet.id::text || ':payout', v_idempotency_key || ':payout');

        -- Record settlement
        update public.game_bets set status = 'CASHED_OUT', payout = v_payout, profit = v_profit, updated_at = now() where id = v_bet.id;

        v_settlement_id := gen_random_uuid();
        insert into public.game_settlements(id, round_id, bet_id, game_key, player_id, outcome, stake, profit, payout, idempotency_key)
        values (v_settlement_id, v_bet.round_id, v_bet.id, 'crash', v_bet.player_id, 'CASHED_OUT', v_bet.amount, v_profit, v_payout, v_idempotency_key);

        insert into public.idempotency_records(operation, idempotency_key, request_hash, response)
        values ('CRASH_AUTO_SETTLE', v_idempotency_key, v_idempotency_key, jsonb_build_object('bet_id', v_bet.id, 'settled', true, 'outcome', 'CASHED_OUT', 'return_units', v_return_units));

        v_settled_count := v_settled_count + 1;
        continue;
      end if;
    end if;

    -- No auto-cashout or auto-cashout > crash point -> LOSS
    select * into v_record from public.idempotency_records where operation = 'CRASH_AUTO_SETTLE' and idempotency_key = v_idempotency_key for update;
    if found then continue; end if;

    v_settlement_id := gen_random_uuid();
    insert into public.game_settlements(id, round_id, bet_id, game_key, player_id, outcome, stake, profit, payout, idempotency_key)
    values (v_settlement_id, v_bet.round_id, v_bet.id, 'crash', v_bet.player_id, 'LOST', v_bet.amount, -v_bet.amount, 0, v_idempotency_key);

    update public.game_bets set status = 'LOST', profit = -v_bet.amount, payout = 0, updated_at = now() where id = v_bet.id;

    insert into public.idempotency_records(operation, idempotency_key, request_hash, response)
    values ('CRASH_AUTO_SETTLE', v_idempotency_key, v_idempotency_key, jsonb_build_object('bet_id', v_bet.id, 'settled', true, 'outcome', 'LOSS'));

    v_settled_count := v_settled_count + 1;
  end loop;

  return jsonb_build_object('round_id', p_round_id, 'auto_settled_count', v_settled_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Add missing create_user_profile and create_user_wallet RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_user_profile(
  p_id uuid,
  p_user_code text,
  p_role text,
  p_created_by uuid,
  p_full_name text,
  p_email text,
  p_status text default 'ACTIVE'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.users%rowtype;
begin
  if not exists (select 1 from public.users where id = p_id) then
    raise exception 'auth user does not exist';
  end if;

  if exists (select 1 from public.users where id = p_id) then
    -- Profile already exists
    select * into v_profile from public.users where id = p_id;
    return jsonb_build_object('id', v_profile.id, 'user_code', v_profile.user_code, 'role', v_profile.role, 'already_exists', true);
  end if;

  insert into public.users(id, user_code, role, created_by, full_name, email, status)
  values (p_id, p_user_code, p_role, p_created_by, p_full_name, p_email, p_status)
  returning * into v_profile;

  insert into public.audit_records(actor_user_id, target_user_id, action, resource_type, resource_id)
  values (p_created_by, p_id, 'USER_PROFILE_CREATED', 'user', p_id::text);

  return jsonb_build_object('id', v_profile.id, 'user_code', v_profile.user_code, 'role', v_profile.role, 'already_exists', false);
end;
$$;

create or replace function public.create_user_wallet(
  p_wallet_id text,
  p_user_id uuid,
  p_balance bigint default 0,
  p_version bigint default 1
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_wallet public.wallets%rowtype;
begin
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'user does not exist';
  end if;

  select * into v_wallet from public.wallets where user_id = p_user_id;
  if found then
    return jsonb_build_object('id', v_wallet.id, 'wallet_id', v_wallet.wallet_id, 'user_id', v_wallet.user_id, 'balance', v_wallet.balance, 'balance_units', v_wallet.balance_units, 'already_exists', true);
  end if;

  insert into public.wallets(wallet_id, user_id, balance, balance_units, version)
  values (p_wallet_id, p_user_id, p_balance / 10, p_balance, p_version)
  returning * into v_wallet;

  insert into public.audit_records(actor_user_id, target_user_id, action, resource_type, resource_id)
  values (p_user_id, p_user_id, 'WALLET_CREATED', 'wallet', v_wallet.id::text);

  return jsonb_build_object('id', v_wallet.id, 'wallet_id', v_wallet.wallet_id, 'user_id', v_wallet.user_id, 'balance', v_wallet.balance, 'balance_units', v_wallet.balance_units, 'already_exists', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Fix financial roulette RPC parameter (p_result -> p_result_data, game_key casing)
-- ---------------------------------------------------------------------------
-- The existing finance_record_round_result already uses p_result_data and game_key correctly
-- Just need to ensure finance_open_round is called with lowercase game_key 'roulette'

-- Add game_wallets owner insertion logic if missing
insert into public.game_wallets(game_id, owner_user_id)
select 'roulette', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'teen-patti', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'dice', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'dragon-tiger', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'andar-bahar', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'color-prediction', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'number-prediction', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

insert into public.game_wallets(game_id, owner_user_id)
select 'wheel', owner_user_id from public.coin_supply where singleton
on conflict (game_id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Grant execute permissions
-- ---------------------------------------------------------------------------
revoke all on function public.finance_generate_crash_point(uuid,text) from public, anon, authenticated;
grant execute on function public.finance_generate_crash_point(uuid,text) to service_role;

revoke all on function public.finance_auto_settle_crash_round(uuid) from public, anon, authenticated;
grant execute on function public.finance_auto_settle_crash_round(uuid) to service_role;

revoke all on function public.create_user_profile(uuid,text,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.create_user_profile(uuid,text,text,uuid,text,text,text) to service_role;

revoke all on function public.create_user_wallet(text,uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function public.create_user_wallet(text,uuid,bigint,bigint) to service_role;
