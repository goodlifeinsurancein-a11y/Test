-- ============================================================================
-- 202609100003: Add recharge system to unified schema (idempotent, additive)
--
-- Mirrors the 202609060002 contract exactly (amount = display tokens,
-- amount_units = deci-token units) so it is safe whether or not the legacy
-- coin_recharge_requests table already exists.
-- ============================================================================

create table if not exists public.coin_recharge_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete restrict,
  target_user_id uuid not null references public.users(id) on delete restrict,
  amount bigint not null check (amount > 0 and amount % 1 = 0),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
  approved_by uuid references public.users(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.coin_recharge_requests add column if not exists amount_units bigint;
alter table public.coin_recharge_requests add column if not exists idempotency_key text;
update public.coin_recharge_requests set amount_units = amount::bigint * 10 where amount_units is null;
update public.coin_recharge_requests set amount_units = amount where amount_units is null and false; -- no-op guard
alter table public.coin_recharge_requests alter column amount_units set not null;
create unique index if not exists coin_recharge_requests_requester_key_idx
  on public.coin_recharge_requests(requester_id, idempotency_key) where idempotency_key is not null;

create index if not exists coin_recharge_requests_target_idx on public.coin_recharge_requests(target_user_id);
create index if not exists coin_recharge_requests_status_idx on public.coin_recharge_requests(status);

-- finance_create_recharge_request RPC
create or replace function public.finance_create_recharge_request(
  p_requester_id uuid,
  p_target_user_id uuid,
  p_amount_units bigint,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.coin_recharge_requests%rowtype;
  v_requester public.users%rowtype;
  v_target public.users%rowtype;
  v_request public.coin_recharge_requests%rowtype;
begin
  if p_amount_units <= 0 or p_amount_units % 10 <> 0 then
    raise exception 'amount must be a positive whole displayed token amount';
  end if;

  select * into v_existing
  from public.coin_recharge_requests
  where requester_id = p_requester_id and idempotency_key = p_idempotency_key
  for update;

  if found then
    return jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  select * into v_requester from public.users where id = p_requester_id;
  select * into v_target from public.users where id = p_target_user_id;

  if not found or v_requester.status <> 'ACTIVE' or v_target.status <> 'ACTIVE' then
    raise exception 'active requester and target required';
  end if;

  if v_requester.created_by <> p_target_user_id then
    raise exception 'recharge target must be the requester parent';
  end if;

  insert into public.coin_recharge_requests(requester_id, target_user_id, amount, amount_units, status, idempotency_key)
  values (p_requester_id, p_target_user_id, p_amount_units / 10, p_amount_units, 'PENDING', p_idempotency_key)
  returning * into v_request;

  return jsonb_build_object('request_id', v_request.id, 'status', v_request.status, 'idempotent', false);
end;
$$;

-- finance_approve_recharge_atomic RPC
create or replace function public.finance_approve_recharge_atomic(
  p_request_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_record public.idempotency_records%rowtype;
  v_request public.coin_recharge_requests%rowtype;
  v_actor public.users%rowtype;
  v_result jsonb;
begin
  select * into v_record
  from public.idempotency_records
  where operation = 'RECHARGE_APPROVAL' and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_record.request_hash <> p_request_hash then
      raise exception 'idempotency key reused with a different request';
    end if;
    return v_record.response;
  end if;

  select * into v_request
  from public.coin_recharge_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'recharge request not found'; end if;
  if v_request.status = 'APPROVED' then raise exception 'approved recharge requires its original idempotency key'; end if;
  if v_request.status <> 'PENDING' then raise exception 'recharge request is not pending'; end if;

  select * into v_actor from public.users where id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' or v_request.target_user_id <> p_actor_id then
    raise exception 'only the active direct parent may approve recharge';
  end if;

  v_result := public.finance_transfer_atomic(
    v_request.target_user_id,
    v_request.requester_id,
    v_request.amount_units,
    'RECHARGE',
    p_idempotency_key || ':transfer',
    p_request_hash,
    'RECHARGE_APPROVED'
  );

  update public.coin_recharge_requests
  set status = 'APPROVED', approved_by = p_actor_id, decided_at = now()
  where id = p_request_id;

  v_result := v_result || jsonb_build_object('request_id', p_request_id, 'status', 'APPROVED');

  insert into public.idempotency_records(operation, idempotency_key, request_hash, response)
  values ('RECHARGE_APPROVAL', p_idempotency_key, p_request_hash, v_result);

  return v_result;
end;
$$;

-- Disable legacy withdrawal functions permanently
create or replace function public.coin_create_withdrawal_request(uuid, numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin raise exception 'withdrawals are permanently disabled for virtual tokens'; end;
$$;

create or replace function public.coin_approve_withdrawal_request(uuid, uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin raise exception 'withdrawals are permanently disabled for virtual tokens'; end;
$$;

create or replace function public.coin_reject_withdrawal_request(uuid, uuid, text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin raise exception 'withdrawals are permanently disabled for virtual tokens'; end;
$$;

-- Wallet debit/credit atomic RPCs used by legacy wallet.service.ts — these do
-- NOT exist in the unified schema. Add them for backward compatibility.
create or replace function public.wallet_debit_atomic(p_player_id uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_wallet public.wallets%rowtype;
  v_result jsonb;
begin
  if p_amount <= 0 then raise exception 'invalid debit amount'; end if;
  select * into v_wallet from public.wallets where user_id = p_player_id for update;
  if not found then raise exception 'wallet not found'; end if;
  if v_wallet.balance_units < p_amount then raise exception 'insufficient wallet balance'; end if;
  update public.wallets set balance_units = balance_units - p_amount, updated_at = now() where id = v_wallet.id;
  perform public.finance_write_wallet_ledger(v_wallet.user_id, v_wallet.id, null, null, 'ADMIN_TRANSFER_DEBIT', -p_amount, v_wallet.balance_units, v_wallet.balance_units - p_amount, 'wallet-debit-' || gen_random_uuid()::text, 'wallet-debit-' || gen_random_uuid()::text);
  select * into v_wallet from public.wallets where user_id = p_player_id;
  v_result := jsonb_build_object('id', v_wallet.id, 'wallet_id', v_wallet.wallet_id, 'user_id', v_wallet.user_id, 'balance_units', v_wallet.balance_units);
  return v_result;
end;
$$;

create or replace function public.wallet_credit_atomic(p_player_id uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_wallet public.wallets%rowtype;
  v_result jsonb;
begin
  if p_amount <= 0 then raise exception 'invalid credit amount'; end if;
  select * into v_wallet from public.wallets where user_id = p_player_id for update;
  if not found then raise exception 'wallet not found'; end if;
  update public.wallets set balance_units = balance_units + p_amount, updated_at = now() where id = v_wallet.id;
  perform public.finance_write_wallet_ledger(v_wallet.user_id, v_wallet.id, null, null, 'ADMIN_TRANSFER_CREDIT', p_amount, v_wallet.balance_units, v_wallet.balance_units + p_amount, 'wallet-credit-' || gen_random_uuid()::text, 'wallet-credit-' || gen_random_uuid()::text);
  select * into v_wallet from public.wallets where user_id = p_player_id;
  v_result := jsonb_build_object('id', v_wallet.id, 'wallet_id', v_wallet.wallet_id, 'user_id', v_wallet.user_id, 'balance_units', v_wallet.balance_units);
  return v_result;
end;
$$;

-- RLS and grants
alter table public.coin_recharge_requests enable row level security;
revoke all on public.coin_recharge_requests from public, anon, authenticated;
grant all on public.coin_recharge_requests to service_role;

revoke all on function public.finance_create_recharge_request(uuid,uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.finance_approve_recharge_atomic(uuid,uuid,text,text) from public, anon, authenticated;

grant execute on function public.finance_create_recharge_request(uuid,uuid,bigint,text) to service_role;
grant execute on function public.finance_approve_recharge_atomic(uuid,uuid,text,text) to service_role;

revoke all on function public.wallet_debit_atomic(uuid,bigint) from public, anon, authenticated;
revoke all on function public.wallet_credit_atomic(uuid,bigint) from public, anon, authenticated;
grant execute on function public.wallet_debit_atomic(uuid,bigint) to service_role;
grant execute on function public.wallet_credit_atomic(uuid,bigint) to service_role;

revoke all on function public.coin_create_withdrawal_request(uuid,numeric) from public, anon, authenticated;
revoke all on function public.coin_approve_withdrawal_request(uuid,uuid) from public, anon, authenticated;
revoke all on function public.coin_reject_withdrawal_request(uuid,uuid,text) from public, anon, authenticated;
