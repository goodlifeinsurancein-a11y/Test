-- Unified game infrastructure tables
-- All amounts are signed BIGINT deci-token units (10 units = one displayed token)

-- game_rounds: Unified round tracking for all games
create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  game_key text not null check (game_key in ('roulette','teen-patti','crash','dice','dragon-tiger','andar-bahar','color-prediction','number-prediction','wheel')),
  round_number bigint not null check (round_number > 0),
  status text not null check (status in ('BETTING','LOCK','PROCESSING','RUNNING','CRASHED','DEAL','COMPARE','GENERATE_RESULT','INDICATOR','MATCH','RESULT','SETTLEMENT','COMPLETED','CANCELLED','RECOVERY_REQUIRED')),
  result_data jsonb,
  started_at timestamptz not null,
  locked_at timestamptz,
  result_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_key, round_number)
);

-- game_bets: Unified bet tracking for all games
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
  updated_at timestamptz not null default now()
);

-- Unique constraint for Teen Patti: exactly one bet per player per round
create unique index if not exists game_bets_teen_patti_unique_player_round
  on public.game_bets (round_id, player_id)
  where game_key = 'teen-patti';

-- Indexes for game_bets
create index if not exists game_bets_round_id_idx on public.game_bets(round_id);
create index if not exists game_bets_player_id_idx on public.game_bets(player_id);
create index if not exists game_bets_idempotency_key_idx on public.game_bets(idempotency_key);
create index if not exists game_bets_status_idx on public.game_bets(status);

-- wallet_transactions: Immutable and auditable wallet ledger
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  player_id uuid not null references public.users(id) on delete restrict,
  bet_id uuid references public.game_bets(id) on delete restrict,
  round_id uuid references public.game_rounds(id) on delete restrict,
  transaction_type text not null check (transaction_type in (
    'GAME_BET_DEBIT',
    'GAME_WIN_CREDIT',
    'GAME_CASHOUT_CREDIT',
    'GAME_REFUND_CREDIT',
    'GAME_VOID_CREDIT',
    'RECHARGE_CREDIT',
    'RECHARGE_DEBIT',
    'ADMIN_TRANSFER_CREDIT',
    'ADMIN_TRANSFER_DEBIT',
    'MIGRATION_OPENING_ALLOCATION'
  )),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

-- Unique constraint to prevent duplicate transactions
create unique index if not exists wallet_transactions_idempotency_idx
  on public.wallet_transactions (idempotency_key, transaction_type);

create index if not exists wallet_transactions_wallet_id_idx on public.wallet_transactions(wallet_id);
create index if not exists wallet_transactions_player_id_idx on public.wallet_transactions(player_id);
create index if not exists wallet_transactions_bet_id_idx on public.wallet_transactions(bet_id);
create index if not exists wallet_transactions_round_id_idx on public.wallet_transactions(round_id);

-- Trigger to make wallet_transactions immutable
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

-- game_settlements: Unified settlement tracking
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

-- Enable RLS on new tables
alter table public.game_rounds enable row level security;
alter table public.game_bets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.game_settlements enable row level security;

-- Service-role only access (Nest uses service role key)
revoke all on public.game_rounds from public, anon, authenticated;
revoke all on public.game_bets from public, anon, authenticated;
revoke all on public.wallet_transactions from public, anon, authenticated;
revoke all on public.game_settlements from public, anon, authenticated;

grant all on public.game_rounds to service_role;
grant all on public.game_bets to service_role;
grant all on public.wallet_transactions to service_role;
grant all on public.game_settlements to service_role;