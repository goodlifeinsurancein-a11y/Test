-- ============================================================================
-- Phase 1: Additive unified game infrastructure wiring.
--
-- Verified target-database state (2026-09-07):
--   * NO financial tables exist yet: game_rounds, game_bets, game_settlements,
--     wallet_transactions, idempotency_records, game_wallets, coin_supply are
--     ALL absent from the live Supabase schema cache.
--   * The legacy roulette schema is live and MUST be preserved:
--       roulette_rounds(round_number,status,result_number,result_color,...)
--       roulette_bets(round_id,player_id,bet_type,bet_value,amount,payout,status)
--   * wallets(user_id,wallet_id,balance,version) exists without balance_units.
--
-- Therefore 202609060001-060004 and 202609070001 were NOT applied.  This
-- migration is the additive phase that creates the unified infrastructure from
-- the plan's own definitions (202609070001) and adapts the atomic/idempotent
-- finance RPCs (from 060001-060004) to the unified columns:
--
--   game_id  -> game_key  (lowercase slug, 1:1 with game_wallets.game_id)
--   amount_units -> amount
--   bet_type/bet_value -> bet_data
--   result -> result_data
--
-- It NEVER drops/rewrites existing tables, NEVER trusts client-supplied
-- results/payouts/multipliers (payouts are derived in RPCs only), and keeps
-- every wallet debit/credit atomic and idempotent via idempotency_records.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Financial base (deci-token ledger on the existing wallets table).
--    Derived from 202609060001: balance_units = balance * 10.
-- ---------------------------------------------------------------------------
alter table public.wallets
  add column if not exists balance_units bigint;

update public.wallets
   set balance_units = balance::bigint * 10
 where balance_units is null;

alter table public.wallets
  alter column balance_units set not null,
  alter column balance_units set default 0;

alter table public.wallets
  drop constraint if exists wallets_balance_units_nonnegative,
  add constraint wallets_balance_units_nonnegative check (balance_units >= 0);

-- ---------------------------------------------------------------------------
-- 2. coin_supply (fixed 10^11 deci-token supply).  Derived from 060001.
-- ---------------------------------------------------------------------------
create table if not exists public.coin_supply (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  total_units bigint not null check (total_units = 100000000000),
  owner_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

do $$
declare v_owner uuid; v_non_owner bigint; v_owner_balance bigint;
begin
  if not exists (select 1 from public.coin_supply) then
    select id into v_owner from public.users where role = 'OWNER' order by created_at limit 1;
    if v_owner is null then raise exception 'cannot initialize supply without exactly one OWNER'; end if;
    if (select count(*) from public.users where role = 'OWNER') <> 1 then raise exception 'coin supply requires exactly one OWNER'; end if;
    select coalesce(sum(balance_units), 0) into v_non_owner from public.wallets where user_id <> v_owner;
    if v_non_owner > 100000000000 then raise exception 'legacy balances exceed approved supply'; end if;
    v_owner_balance := 100000000000 - v_non_owner;
    update public.wallets set balance_units = v_owner_balance, updated_at = now() where user_id = v_owner;
    insert into public.coin_supply(total_units, owner_user_id) values (100000000000, v_owner);
  end if;
end $$;

-- Opening allocation ledger rows are written in a later section, after
-- wallet_transactions exists; that block is idempotent via reference_key.

-- ---------------------------------------------------------------------------
-- 3. game_wallets (per-game liquidity pools).  Derived from 060001, adapted
--    to keep the unified game_key slugs as the pool key.
--    The pooled game_id equality uses the same lowercase slug as game_rounds.
-- ---------------------------------------------------------------------------
create table if not exists public.game_wallets (
  id uuid primary key default gen_random_uuid(),
  game_id text not null check (game_id in ('roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar','color-prediction','number-prediction','wheel')),
  owner_user_id uuid not null references public.users(id) on delete restrict,
  balance_units bigint not null default 0 check (balance_units >= 0),
  last_swept_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id)
);

-- ---------------------------------------------------------------------------
-- 4. Unified tables from 202609070001 (exact definitions; safe because none
--    of these tables exist in the target database yet).
-- ---------------------------------------------------------------------------
create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  game_key text not null check (game_key in ('roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar','color-prediction','number-prediction','wheel')),
  round_number bigint not null check (round_number > 0),
  status text not null check (status in ('BETTING','LOCK','PROCESSING','RUNNING','CRASHED','DEAL','COMPARE','GENERATE_RESULT','INDICATOR','MATCH','RESULT','SETTLEMENT','COMPLETED','CANCELLED','RECOVERY_REQUIRED')),
  result_data jsonb,
  started_at timestamptz not null,
  betting_ends_at timestamptz,
  locked_at timestamptz,
  result_at timestamptz,
  completed_at timestamptz,
  recovery_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_key, round_number)
);

create table if not exists public.game_bets (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.game_rounds(id) on delete restrict,
  game_key text not null check (game_key in ('roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar','color-prediction','number-prediction','wheel')),
  player_id uuid not null references public.users(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  amount bigint not null check (amount > 0 and amount % 10 = 0),
  bet_data jsonb not null default '{}'::jsonb,
  status text not null default 'PLACED' check (status in ('PLACED','CASHED_OUT','WON','LOST','TIED','VOID','REFUNDED')),
  payout bigint,
  profit bigint,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, idempotency_key),
  unique (id, game_key)
);

create unique index if not exists game_bets_teen_patti_unique_player_round
  on public.game_bets (round_id, player_id)
  where game_key = 'teen-patti';

create index if not exists game_bets_round_id_idx on public.game_bets(round_id);
create index if not exists game_bets_player_id_idx on public.game_bets(player_id);
create index if not exists game_bets_idempotency_key_idx on public.game_bets(idempotency_key);
create index if not exists game_bets_status_idx on public.game_bets(status);

-- Unified wallet ledger: derived from 202609070001 plus the two additive
-- columns the atomic finance RPCs require (balance_before = pre-write balance;
-- reference_key = per-write reference for the unique dedupe).  The immutability
-- trigger and idempotency unique index are preserved from 202609070001.
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid references public.wallets(id) on delete restrict,
  game_wallet_id uuid references public.game_wallets(id) on delete restrict,
  player_id uuid references public.users(id) on delete restrict,
  bet_id uuid references public.game_bets(id) on delete restrict,
  round_id uuid references public.game_rounds(id) on delete restrict,
  transaction_type text not null check (transaction_type in (
    'GAME_BET_DEBIT',
    'GAME_WIN_CREDIT',
    'GAME_CASHOUT_CREDIT',
    'GAME_REFUND_CREDIT',
    'GAME_VOID_CREDIT',
    'GAME_POOL_CREDIT',
    'GAME_POOL_DEBIT',
    'GAME_LIQUIDITY_DEBIT',
    'GAME_LIQUIDITY_CREDIT',
    'GAME_SWEEP_DEBIT',
    'GAME_SWEEP_CREDIT',
    'RECHARGE_CREDIT',
    'RECHARGE_DEBIT',
    'ADMIN_TRANSFER_CREDIT',
    'ADMIN_TRANSFER_DEBIT',
    'MIGRATION_OPENING_ALLOCATION'
  )),
  amount bigint not null check (amount <> 0),
  balance_before bigint not null check (balance_before >= 0),
  balance_after bigint not null check (balance_after >= 0),
  reference_key text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  check (balance_after = balance_before + amount),
  check ((wallet_id is not null)::integer + (game_wallet_id is not null)::integer = 1)
);

create unique index if not exists wallet_transactions_idempotency_idx
  on public.wallet_transactions (idempotency_key, transaction_type);

create index if not exists wallet_transactions_wallet_id_idx on public.wallet_transactions(wallet_id);
create index if not exists wallet_transactions_player_id_idx on public.wallet_transactions(player_id);
create index if not exists wallet_transactions_bet_id_idx on public.wallet_transactions(bet_id);
create index if not exists wallet_transactions_round_id_idx on public.wallet_transactions(round_id);

create or replace function public.prevent_wallet_transaction_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'wallet_transactions ledger is immutable';
end;
$$;

drop trigger if exists wallet_transactions_immutable on public.wallet_transactions;
create trigger wallet_transactions_immutable
before update or delete on public.wallet_transactions
for each row execute function public.prevent_wallet_transaction_mutation();

create table if not exists public.game_settlements (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.game_rounds(id) on delete restrict,
  bet_id uuid not null unique references public.game_bets(id) on delete restrict,
  game_key text not null check (game_key in ('roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar','color-prediction','number-prediction','wheel')),
  player_id uuid not null references public.users(id) on delete restrict,
  outcome text not null check (outcome in ('WON','LOST','CASHED_OUT','REFUNDED','VOID')),
  stake bigint not null check (stake > 0),
  profit bigint not null,
  payout bigint not null check (payout >= 0),
  settled_at timestamptz not null default now(),
  idempotency_key text not null unique,
  check (profit = payout - stake)
);

create index if not exists game_settlements_round_id_idx on public.game_settlements(round_id);
create index if not exists game_settlements_player_id_idx on public.game_settlements(player_id);
create index if not exists game_settlements_bet_id_idx on public.game_settlements(bet_id);

-- Idempotency records (unchanged contract from 060001).
create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (operation, idempotency_key)
);

-- Audit records (unchanged contract from 060003).
create table if not exists public.audit_records (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists game_rounds_game_created_idx on public.game_rounds(game_key, created_at desc);
create index if not exists game_bets_round_player_idx on public.game_bets(round_id, player_id);
create index if not exists game_settlements_round_idx on public.game_settlements(round_id);
create index if not exists audit_records_actor_created_idx on public.audit_records(actor_user_id, created_at desc);

-- Opening allocation ledger rows for the pre-existing wallets (idempotent via
-- reference_key; the early coin_supply block only fixes balances, not the ledger).
insert into public.wallet_transactions(wallet_id, player_id, transaction_type, amount, balance_before, balance_after, reference_key, idempotency_key)
  select w.id, w.user_id, 'MIGRATION_OPENING_ALLOCATION', w.balance_units, 0, w.balance_units, 'supply-opening-' || w.id::text, 'supply-opening-' || w.id::text
  from public.wallets w
  where w.balance_units <> 0
    and not exists (
      select 1 from public.wallet_transactions t
      where t.reference_key = 'supply-opening-' || w.id::text
    );

-- ---------------------------------------------------------------------------
-- 5. Unified financial RPCs.
--    Adapted from 060001/060002/060004 to the unified columns.  All are
--    security definer, service-role-only, atomic, and idempotent.
-- ---------------------------------------------------------------------------

-- Ledger writers: keep raw balance snapshots inside the ledger row.
create or replace function public.finance_write_wallet_ledger(p_player_id uuid, p_wallet_id uuid, p_game_key text, p_round_id uuid, p_type text, p_amount bigint, p_before bigint, p_after bigint, p_reference text, p_idempotency_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.wallet_transactions(wallet_id, player_id, bet_id, round_id, transaction_type, amount, balance_before, balance_after, reference_key, idempotency_key)
  values (p_wallet_id, p_player_id, null, p_round_id, p_type, p_amount, p_before, p_after, p_reference, p_idempotency_key);
$$;

create or replace function public.finance_write_pool_ledger(p_game_wallet_id uuid, p_round_id uuid, p_type text, p_amount bigint, p_before bigint, p_after bigint, p_reference text, p_idempotency_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.wallet_transactions(game_wallet_id, player_id, bet_id, round_id, transaction_type, amount, balance_before, balance_after, reference_key, idempotency_key)
  values (p_game_wallet_id, null, null, p_round_id, p_type, p_amount, p_before, p_after, p_reference, p_idempotency_key);
$$;

-- Open a round (idempotent by id; conflict if same id used for a different round).
create or replace function public.finance_open_round(p_round_id uuid, p_game_key text, p_round_number bigint, p_status text, p_started_at timestamptz, p_betting_ends_at timestamptz, p_recovery_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.game_rounds%rowtype;
begin
  select * into v_existing from public.game_rounds where id = p_round_id;
  if found then
    if v_existing.game_key <> p_game_key or v_existing.round_number <> p_round_number then raise exception 'round id conflict'; end if;
    return jsonb_build_object('round_id', v_existing.id, 'already_exists', true);
  end if;
  insert into public.game_rounds(id, game_key, round_number, status, started_at, betting_ends_at, recovery_data)
  values (p_round_id, p_game_key, p_round_number, p_status, p_started_at, p_betting_ends_at, coalesce(p_recovery_data, '{}'::jsonb));
  return jsonb_build_object('round_id', p_round_id, 'already_exists', false);
end;
$$;

-- Place a bet: atomic debit + pool credit + bet row, idempotent via
-- idempotency_records.  Bet amount and game are never client-controlled beyond
-- the player's own stake; the round must be in BETTING and the player ACTIVE.
create or replace function public.finance_place_bet_atomic(p_bet_id uuid, p_player_id uuid, p_game_key text, p_round_id uuid, p_bet_data jsonb, p_amount bigint, p_idempotency_key text, p_request_hash text, p_wallet_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_wallet public.wallets%rowtype; v_round public.game_rounds%rowtype; v_pool public.game_wallets%rowtype; v_owner uuid; v_response jsonb;
begin
  if p_amount <= 0 or p_amount % 10 <> 0 then raise exception 'amount must be positive whole displayed tokens in deci-token units'; end if;
  select * into v_record from public.idempotency_records where operation = 'GAME_BET' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if;
    return v_record.response;
  end if;
  select * into v_round from public.game_rounds where id = p_round_id and game_key = p_game_key for update;
  if not found or v_round.status <> 'BETTING' or (v_round.betting_ends_at is not null and v_round.betting_ends_at <= now()) then raise exception 'betting is closed'; end if;
  if not exists (select 1 from public.users where id = p_player_id and role = 'PLAYER' and status = 'ACTIVE') then raise exception 'active PLAYER required'; end if;
  if p_wallet_id is null then
    select * into v_wallet from public.wallets where user_id = p_player_id for update;
  else
    select * into v_wallet from public.wallets where id = p_wallet_id and user_id = p_player_id for update;
  end if;
  if not found or v_wallet.balance_units < p_amount then raise exception 'insufficient wallet balance'; end if;
  select owner_user_id into v_owner from public.coin_supply where singleton;
  insert into public.game_wallets(game_id, owner_user_id) values (p_game_key, v_owner) on conflict (game_id) do nothing;
  select * into v_pool from public.game_wallets where game_id = p_game_key for update;
  update public.wallets set balance_units = v_wallet.balance_units - p_amount, updated_at = now() where id = v_wallet.id;
  perform public.finance_write_wallet_ledger(p_player_id, v_wallet.id, p_game_key, p_round_id, 'GAME_BET_DEBIT', -p_amount, v_wallet.balance_units, v_wallet.balance_units - p_amount, p_bet_id::text, p_idempotency_key);
  update public.game_wallets set balance_units = v_pool.balance_units + p_amount, updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, p_round_id, 'GAME_POOL_CREDIT', p_amount, v_pool.balance_units, v_pool.balance_units + p_amount, p_bet_id::text, p_idempotency_key);
  insert into public.game_bets(id, round_id, game_key, player_id, wallet_id, amount, bet_data, idempotency_key)
  values (p_bet_id, p_round_id, p_game_key, p_player_id, v_wallet.id, p_amount, coalesce(p_bet_data, '{}'::jsonb), p_idempotency_key);
  v_response := jsonb_build_object('bet_id', p_bet_id, 'round_id', p_round_id, 'amount', p_amount, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('GAME_BET', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

-- Settle a bet: derive payout strictly from the server path (p_return_units is
-- produced by the engine, never by the client), credit the player, debit the
-- pool (with owner liquidity top-up when needed), and write the settlement row.
-- Idempotent via idempotency_records; a bet cannot be settled twice.
create or replace function public.finance_settle_bet_atomic(p_bet_id uuid, p_outcome text, p_return_units bigint, p_idempotency_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_bet public.game_bets%rowtype; v_pool public.game_wallets%rowtype; v_player public.wallets%rowtype; v_owner public.wallets%rowtype; v_shortfall bigint; v_payout bigint; v_profit bigint; v_response jsonb;
begin
  if p_return_units < 0 then raise exception 'return cannot be negative'; end if;
  select * into v_record from public.idempotency_records where operation = 'GAME_SETTLEMENT' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if;
    return v_record.response;
  end if;
  select * into v_bet from public.game_bets where id = p_bet_id for update;
  if not found then raise exception 'bet not found'; end if;
  if exists (select 1 from public.game_settlements where bet_id = p_bet_id) then raise exception 'bet already settled with a different idempotency key'; end if;
  select * into v_pool from public.game_wallets where game_id = v_bet.game_key for update;
  select * into v_player from public.wallets where id = v_bet.wallet_id for update;
  if p_return_units > v_pool.balance_units then
    v_shortfall := p_return_units - v_pool.balance_units;
    select w.* into v_owner from public.wallets w join public.coin_supply s on s.owner_user_id = w.user_id where s.singleton for update;
    if not found or v_owner.balance_units < v_shortfall then raise exception 'insufficient owner game liquidity'; end if;
    update public.wallets set balance_units = v_owner.balance_units - v_shortfall, updated_at = now() where id = v_owner.id;
    perform public.finance_write_wallet_ledger(v_owner.user_id, v_owner.id, v_bet.game_key, v_bet.round_id, 'GAME_LIQUIDITY_DEBIT', -v_shortfall, v_owner.balance_units, v_owner.balance_units-v_shortfall, p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');
    update public.game_wallets set balance_units = balance_units + v_shortfall, updated_at = now() where id = v_pool.id;
    perform public.finance_write_pool_ledger(v_pool.id, v_bet.round_id, 'GAME_LIQUIDITY_CREDIT', v_shortfall, v_pool.balance_units, v_pool.balance_units+v_shortfall, p_bet_id::text || ':liquidity', p_idempotency_key || ':liquidity');
    v_pool.balance_units := v_pool.balance_units + v_shortfall;
  end if;
  if p_return_units > 0 then
    update public.game_wallets set balance_units = v_pool.balance_units - p_return_units, updated_at = now() where id = v_pool.id;
    perform public.finance_write_pool_ledger(v_pool.id, v_bet.round_id, 'GAME_POOL_DEBIT', -p_return_units, v_pool.balance_units, v_pool.balance_units-p_return_units, p_bet_id::text || ':payout', p_idempotency_key || ':payout');
    update public.wallets set balance_units = v_player.balance_units + p_return_units, updated_at = now() where id = v_player.id;
    perform public.finance_write_wallet_ledger(v_player.user_id, v_player.id, v_bet.game_key, v_bet.round_id, 'GAME_WIN_CREDIT', p_return_units, v_player.balance_units, v_player.balance_units+p_return_units, p_bet_id::text || ':payout', p_idempotency_key || ':payout');
  end if;
  v_payout := p_return_units;
  v_profit := p_return_units - v_bet.amount;
  update public.game_bets set status = case p_outcome when 'WIN' then 'WON' when 'TIE' then 'TIED' when 'CASHOUT' then 'CASHED_OUT' when 'VOID' then 'VOID' when 'REFUND' then 'REFUNDED' else 'LOST' end, payout = v_payout, profit = v_profit, updated_at = now() where id = p_bet_id;
  insert into public.game_settlements(round_id, bet_id, game_key, player_id, outcome, stake, profit, payout, idempotency_key)
  values (v_bet.round_id, p_bet_id, v_bet.game_key, v_bet.player_id, case p_outcome when 'WIN' then 'WON' when 'TIE' then 'TIED' when 'CASHOUT' then 'CASHED_OUT' when 'VOID' then 'VOID' when 'REFUND' then 'REFUNDED' else 'LOST' end, v_bet.amount, v_profit, v_payout, p_idempotency_key);
  v_response := jsonb_build_object('bet_id', p_bet_id, 'return_units', p_return_units, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('GAME_SETTLEMENT', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

-- Record a round result.  The result payload is produced by the server-side
-- engine only; this RPC refuses to overwrite an existing result and never
-- invents one.  result_data is the unified column (no legacy result column
-- exists in the unified schema; derived from 060004's contract).
create or replace function public.finance_record_round_result(p_round_id uuid, p_status text, p_result_data jsonb, p_result_at timestamptz, p_completed_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_round public.game_rounds%rowtype;
begin
  select * into v_round from public.game_rounds where id = p_round_id for update;
  if not found then raise exception 'round not found'; end if;
  if v_round.result_data is not null and v_round.result_data <> p_result_data then raise exception 'round result is immutable'; end if;
  update public.game_rounds set status = p_status, result_data = coalesce(v_round.result_data, p_result_data), result_at = coalesce(v_round.result_at, p_result_at), completed_at = coalesce(p_completed_at, completed_at), updated_at = now() where id = p_round_id;
  return jsonb_build_object('round_id', p_round_id, 'already_recorded', v_round.result_data is not null);
end;
$$;

-- A process restart cannot invent a result.  Rounds with an unrecorded result
-- are explicitly marked for operator/recovery handling.
create or replace function public.finance_mark_interrupted_rounds_for_recovery()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  update public.game_rounds set status = 'RECOVERY_REQUIRED', updated_at = now()
  where status not in ('COMPLETED','RECOVERY_REQUIRED') and result_data is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Game wallet sweep (unchanged contract from 060001).
create or replace function public.finance_sweep_game_wallet_atomic(p_game_key text, p_idempotency_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_pool public.game_wallets%rowtype; v_owner public.wallets%rowtype; v_response jsonb;
begin
  select * into v_record from public.idempotency_records where operation = 'GAME_SWEEP' and idempotency_key = p_idempotency_key for update;
  if found then if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if; return v_record.response; end if;
  select * into v_pool from public.game_wallets where game_id = p_game_key for update;
  if not found then raise exception 'game wallet not found'; end if;
  if v_pool.updated_at > now() - interval '24 hours' then raise exception 'game wallet is not eligible for 24-hour sweep'; end if;
  select w.* into v_owner from public.wallets w where w.user_id = v_pool.owner_user_id for update;
  update public.game_wallets set balance_units = 0, last_swept_at = now(), updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, null, 'GAME_SWEEP_DEBIT', -v_pool.balance_units, v_pool.balance_units, 0, p_idempotency_key, p_idempotency_key);
  update public.wallets set balance_units = v_owner.balance_units + v_pool.balance_units, updated_at = now() where id = v_owner.id;
  perform public.finance_write_wallet_ledger(v_owner.user_id, v_owner.id, p_game_key, null, 'GAME_SWEEP_CREDIT', v_pool.balance_units, v_owner.balance_units, v_owner.balance_units+v_pool.balance_units, p_idempotency_key, p_idempotency_key);
  v_response := jsonb_build_object('game_key', p_game_key, 'swept_units', v_pool.balance_units, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('GAME_SWEEP', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

-- Non-game transfers (unchanged contract from 060002; used by recharge flow).
create or replace function public.finance_transfer_atomic(p_from_user_id uuid, p_to_user_id uuid, p_amount bigint, p_operation text, p_idempotency_key text, p_request_hash text, p_audit_action text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_from public.wallets%rowtype; v_to public.wallets%rowtype; v_response jsonb;
begin
  if p_from_user_id = p_to_user_id or p_amount <= 0 then raise exception 'invalid transfer'; end if;
  select * into v_record from public.idempotency_records where operation = p_operation and idempotency_key = p_idempotency_key for update;
  if found then
    if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if;
    return v_record.response;
  end if;
  if p_from_user_id < p_to_user_id then
    select * into v_from from public.wallets where user_id = p_from_user_id for update;
    select * into v_to from public.wallets where user_id = p_to_user_id for update;
  else
    select * into v_to from public.wallets where user_id = p_to_user_id for update;
    select * into v_from from public.wallets where user_id = p_from_user_id for update;
  end if;
  if not found or v_from.id is null or v_to.id is null then raise exception 'wallet not found'; end if;
  if v_from.balance_units < p_amount then raise exception 'insufficient wallet balance'; end if;
  update public.wallets set balance_units = v_from.balance_units-p_amount, updated_at = now() where id = v_from.id;
  perform public.finance_write_wallet_ledger(p_from_user_id, v_from.id, null, null, case when p_operation = 'RECHARGE' then 'RECHARGE_DEBIT' else 'ADMIN_TRANSFER_DEBIT' end, -p_amount, v_from.balance_units, v_from.balance_units-p_amount, p_idempotency_key, p_idempotency_key);
  update public.wallets set balance_units = v_to.balance_units+p_amount, updated_at = now() where id = v_to.id;
  perform public.finance_write_wallet_ledger(p_to_user_id, v_to.id, null, null, case when p_operation = 'RECHARGE' then 'RECHARGE_CREDIT' else 'ADMIN_TRANSFER_CREDIT' end, p_amount, v_to.balance_units, v_to.balance_units+p_amount, p_idempotency_key, p_idempotency_key);
  if p_audit_action is not null then
    insert into public.audit_records(actor_user_id, target_user_id, action, resource_type, resource_id, metadata)
    values (p_from_user_id, p_to_user_id, p_audit_action, 'wallet_transfer', p_idempotency_key, jsonb_build_object('amount', p_amount));
  end if;
  v_response := jsonb_build_object('from_user_id', p_from_user_id, 'to_user_id', p_to_user_id, 'amount', p_amount, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values (p_operation, p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

-- Wallet creation (contract from 060003, adapted to unified surface).
create or replace function public.finance_create_wallet(p_user_id uuid, p_wallet_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_wallet public.wallets%rowtype;
begin
  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if found then return jsonb_build_object('id', v_wallet.id, 'wallet_id', v_wallet.wallet_id, 'user_id', v_wallet.user_id, 'balance_units', v_wallet.balance_units, 'already_exists', true); end if;
  insert into public.wallets(wallet_id, user_id, balance, balance_units, version)
  values (p_wallet_id, p_user_id, 0, 0, 1) returning * into v_wallet;
  insert into public.audit_records(actor_user_id, target_user_id, action, resource_type, resource_id)
  values (p_user_id, p_user_id, 'WALLET_CREATED', 'wallet', v_wallet.id::text);
  return jsonb_build_object('id', v_wallet.id, 'wallet_id', v_wallet.wallet_id, 'user_id', v_wallet.user_id, 'balance_units', 0, 'already_exists', false);
end;
$$;

create or replace function public.finance_audit(p_actor_user_id uuid, p_target_user_id uuid, p_action text, p_resource_type text, p_resource_id text, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_records(actor_user_id, target_user_id, action, resource_type, resource_id, metadata)
  values (p_actor_user_id, p_target_user_id, p_action, p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS + service-role-only access (mirrors 060001/060004/070001 posture).
-- ---------------------------------------------------------------------------
alter table public.coin_supply enable row level security;
alter table public.game_wallets enable row level security;
alter table public.game_rounds enable row level security;
alter table public.game_bets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.game_settlements enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.audit_records enable row level security;

revoke all on public.coin_supply from public, anon, authenticated;
revoke all on public.game_wallets from public, anon, authenticated;
revoke all on public.game_rounds from public, anon, authenticated;
revoke all on public.game_bets from public, anon, authenticated;
revoke all on public.wallet_transactions from public, anon, authenticated;
revoke all on public.game_settlements from public, anon, authenticated;
revoke all on public.idempotency_records from public, anon, authenticated;
revoke all on public.audit_records from public, anon, authenticated;

grant all on public.coin_supply to service_role;
grant all on public.game_wallets to service_role;
grant all on public.game_rounds to service_role;
grant all on public.game_bets to service_role;
grant all on public.wallet_transactions to service_role;
grant all on public.game_settlements to service_role;
grant all on public.idempotency_records to service_role;
grant all on public.audit_records to service_role;

revoke all on function public.finance_open_round(uuid,text,bigint,text,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.finance_place_bet_atomic(uuid,uuid,text,uuid,jsonb,bigint,text,text,uuid) from public, anon, authenticated;
revoke all on function public.finance_settle_bet_atomic(uuid,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.finance_record_round_result(uuid,text,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.finance_mark_interrupted_rounds_for_recovery() from public, anon, authenticated;
revoke all on function public.finance_sweep_game_wallet_atomic(text,text,text) from public, anon, authenticated;
revoke all on function public.finance_transfer_atomic(uuid,uuid,bigint,text,text,text,text) from public, anon, authenticated;
revoke all on function public.finance_create_wallet(uuid,text) from public, anon, authenticated;
revoke all on function public.finance_audit(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.finance_write_wallet_ledger(uuid,uuid,text,uuid,text,bigint,bigint,bigint,text,text) from public, anon, authenticated;
revoke all on function public.finance_write_pool_ledger(uuid,uuid,text,bigint,bigint,bigint,text,text) from public, anon, authenticated;

grant execute on function public.finance_open_round(uuid,text,bigint,text,timestamptz,timestamptz,jsonb) to service_role;
grant execute on function public.finance_place_bet_atomic(uuid,uuid,text,uuid,jsonb,bigint,text,text,uuid) to service_role;
grant execute on function public.finance_settle_bet_atomic(uuid,text,bigint,text,text) to service_role;
grant execute on function public.finance_record_round_result(uuid,text,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.finance_mark_interrupted_rounds_for_recovery() to service_role;
grant execute on function public.finance_sweep_game_wallet_atomic(text,text,text) to service_role;
grant execute on function public.finance_transfer_atomic(uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.finance_create_wallet(uuid,text) to service_role;
grant execute on function public.finance_audit(uuid,uuid,text,text,text,jsonb) to service_role;
