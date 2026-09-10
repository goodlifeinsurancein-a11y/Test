-- BrixVirtualTokens financial foundation.  All amounts are signed BIGINT
-- deci-token units (10 units = one displayed token).  No floating point
-- type is used by this migration.

create extension if not exists pgcrypto;

alter table public.wallets
  add column if not exists balance_units bigint;

-- The legacy balance was whole displayed tokens.  Keep it untouched as a
-- compatibility field; all new financial code reads balance_units only.
update public.wallets
set balance_units = balance::bigint * 10
where balance_units is null;

alter table public.wallets
  alter column balance_units set not null,
  alter column balance_units set default 0;

alter table public.wallets
  drop constraint if exists wallets_balance_units_nonnegative,
  add constraint wallets_balance_units_nonnegative check (balance_units >= 0);

create table if not exists public.coin_supply (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  total_units bigint not null check (total_units = 100000000000),
  owner_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.game_wallets (
  id uuid primary key default gen_random_uuid(),
  game_id text not null check (game_id in ('ROULETTE','TEEN_PATTI','CRASH','DICE','DRAGON_TIGER','ANDAR_BAHAR','COLOR_PREDICTION','NUMBER_PREDICTION','WHEEL')),
  owner_user_id uuid not null references public.users(id) on delete restrict,
  balance_units bigint not null default 0 check (balance_units >= 0),
  last_swept_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id)
);

create table if not exists public.game_rounds (
  id uuid primary key,
  game_id text not null check (game_id in ('ROULETTE','TEEN_PATTI','CRASH','DICE','DRAGON_TIGER','ANDAR_BAHAR','COLOR_PREDICTION','NUMBER_PREDICTION','WHEEL')),
  round_number bigint not null check (round_number > 0),
  status text not null check (status in ('BETTING','LOCK','PROCESSING','DEAL','COMPARE','RUNNING','CRASH','ROLL','INDICATOR','MATCH','GENERATE_RESULT','RESULT','SETTLEMENT','COMPLETED','RECOVERY_REQUIRED')),
  started_at timestamptz not null,
  betting_ends_at timestamptz,
  locked_at timestamptz,
  result_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  recovery_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, round_number)
);

create table if not exists public.game_bets (
  id uuid primary key,
  game_id text not null check (game_id in ('ROULETTE','TEEN_PATTI','CRASH','DICE','DRAGON_TIGER','ANDAR_BAHAR','COLOR_PREDICTION','NUMBER_PREDICTION','WHEEL')),
  round_id uuid not null references public.game_rounds(id) on delete restrict,
  player_id uuid not null references public.users(id) on delete restrict,
  bet_type text not null,
  bet_value jsonb not null default '{}'::jsonb,
  amount_units bigint not null check (amount_units > 0 and amount_units % 10 = 0),
  status text not null default 'PLACED' check (status in ('PLACED','CASHED_OUT','WON','LOST','TIED','VOID')),
  idempotency_key text not null,
  placed_at timestamptz not null default now(),
  unique (player_id, idempotency_key),
  unique (id, game_id)
);

create table if not exists public.game_settlements (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null unique references public.game_bets(id) on delete restrict,
  game_id text not null,
  round_id uuid not null references public.game_rounds(id) on delete restrict,
  player_id uuid not null references public.users(id) on delete restrict,
  outcome text not null check (outcome in ('WIN','LOSS','TIE','CASHOUT','VOID')),
  stake_units bigint not null check (stake_units > 0),
  profit_units bigint not null,
  return_units bigint not null check (return_units >= 0),
  settled_at timestamptz not null default now(),
  idempotency_key text not null unique,
  check (profit_units = return_units - stake_units)
);

create table if not exists public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (operation, idempotency_key)
);

create table if not exists public.wallet_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete restrict,
  wallet_id uuid references public.wallets(id) on delete restrict,
  game_wallet_id uuid references public.game_wallets(id) on delete restrict,
  game_id text,
  round_id uuid references public.game_rounds(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('MIGRATION_OPENING_ALLOCATION','RECHARGE_DEBIT','RECHARGE_CREDIT','GAME_BET_DEBIT','GAME_POOL_CREDIT','GAME_PAYOUT_CREDIT','GAME_POOL_DEBIT','GAME_LIQUIDITY_DEBIT','GAME_LIQUIDITY_CREDIT','GAME_SWEEP_DEBIT','GAME_SWEEP_CREDIT','ADMIN_TRANSFER_DEBIT','ADMIN_TRANSFER_CREDIT')),
  amount_units bigint not null check (amount_units <> 0),
  balance_before_units bigint not null check (balance_before_units >= 0),
  balance_after_units bigint not null check (balance_after_units >= 0),
  reference_key text not null,
  created_at timestamptz not null default now(),
  check (balance_after_units = balance_before_units + amount_units),
  check ((wallet_id is not null)::integer + (game_wallet_id is not null)::integer = 1),
  unique (transaction_type, reference_key, wallet_id, game_wallet_id)
);

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

create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id, created_at desc);
create index if not exists wallet_transactions_round_idx on public.wallet_transactions(round_id, created_at);
create index if not exists game_rounds_game_created_idx on public.game_rounds(game_id, created_at desc);
create index if not exists game_bets_round_player_idx on public.game_bets(round_id, player_id);
create index if not exists game_settlements_round_idx on public.game_settlements(round_id);
create index if not exists audit_records_actor_created_idx on public.audit_records(actor_user_id, created_at desc);

create or replace function public.prevent_financial_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'financial ledger is immutable';
end;
$$;
drop trigger if exists wallet_transactions_immutable on public.wallet_transactions;
create trigger wallet_transactions_immutable before update or delete on public.wallet_transactions
for each row execute function public.prevent_financial_mutation();

-- Establish the fixed supply once. Legacy non-owner balances are carried as
-- opening allocations. The owner receives the exact remaining supply, so the
-- opening ledger is conserved even when legacy test data already exists.
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
    insert into public.wallet_transactions(user_id, wallet_id, transaction_type, amount_units, balance_before_units, balance_after_units, reference_key)
      select w.user_id, w.id, 'MIGRATION_OPENING_ALLOCATION', w.balance_units, 0, w.balance_units, 'supply-opening-' || w.id::text
      from public.wallets w where w.balance_units <> 0;
  end if;
end $$;

create or replace function public.finance_write_wallet_ledger(p_user_id uuid, p_wallet_id uuid, p_game_id text, p_round_id uuid, p_type text, p_amount bigint, p_before bigint, p_after bigint, p_reference text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.wallet_transactions(user_id, wallet_id, game_id, round_id, transaction_type, amount_units, balance_before_units, balance_after_units, reference_key)
  values (p_user_id, p_wallet_id, p_game_id, p_round_id, p_type, p_amount, p_before, p_after, p_reference);
$$;

create or replace function public.finance_write_pool_ledger(p_game_wallet_id uuid, p_game_id text, p_round_id uuid, p_type text, p_amount bigint, p_before bigint, p_after bigint, p_reference text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.wallet_transactions(game_wallet_id, game_id, round_id, transaction_type, amount_units, balance_before_units, balance_after_units, reference_key)
  values (p_game_wallet_id, p_game_id, p_round_id, p_type, p_amount, p_before, p_after, p_reference);
$$;

create or replace function public.finance_open_round(p_round_id uuid, p_game_id text, p_round_number bigint, p_status text, p_started_at timestamptz, p_betting_ends_at timestamptz, p_recovery_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.game_rounds%rowtype;
begin
  select * into v_existing from public.game_rounds where id = p_round_id;
  if found then
    if v_existing.game_id <> p_game_id or v_existing.round_number <> p_round_number then raise exception 'round id conflict'; end if;
    return jsonb_build_object('round_id', v_existing.id, 'already_exists', true);
  end if;
  insert into public.game_rounds(id, game_id, round_number, status, started_at, betting_ends_at, recovery_data)
  values (p_round_id, p_game_id, p_round_number, p_status, p_started_at, p_betting_ends_at, coalesce(p_recovery_data, '{}'::jsonb));
  return jsonb_build_object('round_id', p_round_id, 'already_exists', false);
end;
$$;

create or replace function public.finance_place_bet_atomic(p_bet_id uuid, p_player_id uuid, p_game_id text, p_round_id uuid, p_bet_type text, p_bet_value jsonb, p_amount_units bigint, p_idempotency_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_wallet public.wallets%rowtype; v_round public.game_rounds%rowtype; v_pool public.game_wallets%rowtype; v_owner uuid; v_response jsonb;
begin
  if p_amount_units <= 0 or p_amount_units % 10 <> 0 then raise exception 'amount must be positive whole displayed tokens in deci-token units'; end if;
  select * into v_record from public.idempotency_records where operation = 'GAME_BET' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if;
    return v_record.response;
  end if;
  select * into v_round from public.game_rounds where id = p_round_id and game_id = p_game_id for update;
  if not found or v_round.status <> 'BETTING' or (v_round.betting_ends_at is not null and v_round.betting_ends_at <= now()) then raise exception 'betting is closed'; end if;
  if not exists (select 1 from public.users where id = p_player_id and role = 'PLAYER' and status = 'ACTIVE') then raise exception 'active PLAYER required'; end if;
  select * into v_wallet from public.wallets where user_id = p_player_id for update;
  if not found or v_wallet.balance_units < p_amount_units then raise exception 'insufficient wallet balance'; end if;
  select owner_user_id into v_owner from public.coin_supply where singleton;
  insert into public.game_wallets(game_id, owner_user_id) values (p_game_id, v_owner) on conflict (game_id) do nothing;
  select * into v_pool from public.game_wallets where game_id = p_game_id for update;
  update public.wallets set balance_units = v_wallet.balance_units - p_amount_units, updated_at = now() where id = v_wallet.id;
  perform public.finance_write_wallet_ledger(p_player_id, v_wallet.id, p_game_id, p_round_id, 'GAME_BET_DEBIT', -p_amount_units, v_wallet.balance_units, v_wallet.balance_units - p_amount_units, p_bet_id::text);
  update public.game_wallets set balance_units = v_pool.balance_units + p_amount_units, updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, p_game_id, p_round_id, 'GAME_POOL_CREDIT', p_amount_units, v_pool.balance_units, v_pool.balance_units + p_amount_units, p_bet_id::text);
  insert into public.game_bets(id, game_id, round_id, player_id, bet_type, bet_value, amount_units, idempotency_key) values (p_bet_id, p_game_id, p_round_id, p_player_id, p_bet_type, coalesce(p_bet_value, '{}'::jsonb), p_amount_units, p_idempotency_key);
  v_response := jsonb_build_object('bet_id', p_bet_id, 'round_id', p_round_id, 'amount_units', p_amount_units, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('GAME_BET', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.finance_settle_bet_atomic(p_bet_id uuid, p_outcome text, p_return_units bigint, p_idempotency_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_bet public.game_bets%rowtype; v_pool public.game_wallets%rowtype; v_player public.wallets%rowtype; v_owner public.wallets%rowtype; v_shortfall bigint; v_response jsonb;
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
  select * into v_pool from public.game_wallets where game_id = v_bet.game_id for update;
  select * into v_player from public.wallets where user_id = v_bet.player_id for update;
  if p_return_units > v_pool.balance_units then
    v_shortfall := p_return_units - v_pool.balance_units;
    select w.* into v_owner from public.wallets w join public.coin_supply s on s.owner_user_id = w.user_id where s.singleton for update;
    if not found or v_owner.balance_units < v_shortfall then raise exception 'insufficient owner game liquidity'; end if;
    update public.wallets set balance_units = v_owner.balance_units - v_shortfall, updated_at = now() where id = v_owner.id;
    perform public.finance_write_wallet_ledger(v_owner.user_id, v_owner.id, v_bet.game_id, v_bet.round_id, 'GAME_LIQUIDITY_DEBIT', -v_shortfall, v_owner.balance_units, v_owner.balance_units-v_shortfall, p_bet_id::text || ':liquidity');
    update public.game_wallets set balance_units = balance_units + v_shortfall, updated_at = now() where id = v_pool.id;
    perform public.finance_write_pool_ledger(v_pool.id, v_bet.game_id, v_bet.round_id, 'GAME_LIQUIDITY_CREDIT', v_shortfall, v_pool.balance_units, v_pool.balance_units+v_shortfall, p_bet_id::text || ':liquidity');
    v_pool.balance_units := v_pool.balance_units + v_shortfall;
  end if;
  update public.game_wallets set balance_units = v_pool.balance_units - p_return_units, updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, v_bet.game_id, v_bet.round_id, 'GAME_POOL_DEBIT', -p_return_units, v_pool.balance_units, v_pool.balance_units-p_return_units, p_bet_id::text || ':payout');
  if p_return_units > 0 then
    update public.wallets set balance_units = v_player.balance_units + p_return_units, updated_at = now() where id = v_player.id;
    perform public.finance_write_wallet_ledger(v_player.user_id, v_player.id, v_bet.game_id, v_bet.round_id, 'GAME_PAYOUT_CREDIT', p_return_units, v_player.balance_units, v_player.balance_units+p_return_units, p_bet_id::text || ':payout');
  end if;
  insert into public.game_settlements(bet_id, game_id, round_id, player_id, outcome, stake_units, profit_units, return_units, idempotency_key)
  values (p_bet_id, v_bet.game_id, v_bet.round_id, v_bet.player_id, p_outcome, v_bet.amount_units, p_return_units-v_bet.amount_units, p_return_units, p_idempotency_key);
  update public.game_bets set status = case p_outcome when 'WIN' then 'WON' when 'TIE' then 'TIED' when 'CASHOUT' then 'CASHED_OUT' else 'LOST' end where id = p_bet_id;
  v_response := jsonb_build_object('bet_id', p_bet_id, 'return_units', p_return_units, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('GAME_SETTLEMENT', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.finance_sweep_game_wallet_atomic(p_game_id text, p_idempotency_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_pool public.game_wallets%rowtype; v_owner public.wallets%rowtype; v_response jsonb;
begin
  select * into v_record from public.idempotency_records where operation = 'GAME_SWEEP' and idempotency_key = p_idempotency_key for update;
  if found then if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if; return v_record.response; end if;
  select * into v_pool from public.game_wallets where game_id = p_game_id for update;
  if not found then raise exception 'game wallet not found'; end if;
  if v_pool.updated_at > now() - interval '24 hours' then raise exception 'game wallet is not eligible for 24-hour sweep'; end if;
  select w.* into v_owner from public.wallets w where w.user_id = v_pool.owner_user_id for update;
  update public.game_wallets set balance_units = 0, last_swept_at = now(), updated_at = now() where id = v_pool.id;
  perform public.finance_write_pool_ledger(v_pool.id, p_game_id, null, 'GAME_SWEEP_DEBIT', -v_pool.balance_units, v_pool.balance_units, 0, p_idempotency_key);
  update public.wallets set balance_units = v_owner.balance_units + v_pool.balance_units, updated_at = now() where id = v_owner.id;
  perform public.finance_write_wallet_ledger(v_owner.user_id, v_owner.id, p_game_id, null, 'GAME_SWEEP_CREDIT', v_pool.balance_units, v_owner.balance_units, v_owner.balance_units+v_pool.balance_units, p_idempotency_key);
  v_response := jsonb_build_object('game_id', p_game_id, 'swept_units', v_pool.balance_units, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('GAME_SWEEP', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

-- Service-role-only financial surface. RLS protects rows if any non-service
-- database credential is ever used; the Nest service uses server credentials.
alter table public.coin_supply enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.game_wallets enable row level security;
alter table public.game_rounds enable row level security;
alter table public.game_bets enable row level security;
alter table public.game_settlements enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.audit_records enable row level security;
revoke all on function public.finance_open_round(uuid,text,bigint,text,timestamptz,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.finance_place_bet_atomic(uuid,uuid,text,uuid,text,jsonb,bigint,text,text) from public, anon, authenticated;
revoke all on function public.finance_settle_bet_atomic(uuid,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.finance_sweep_game_wallet_atomic(text,text,text) from public, anon, authenticated;
