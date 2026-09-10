-- Non-game transfers and virtual-token recharge. Amounts are deci-token units.

alter table public.coin_recharge_requests add column if not exists amount_units bigint;
alter table public.coin_recharge_requests add column if not exists idempotency_key text;
update public.coin_recharge_requests set amount_units = amount::bigint * 10 where amount_units is null;
alter table public.coin_recharge_requests alter column amount_units set not null;
create unique index if not exists coin_recharge_requests_requester_key_idx
  on public.coin_recharge_requests(requester_id, idempotency_key) where idempotency_key is not null;

create or replace function public.finance_transfer_atomic(p_from_user_id uuid, p_to_user_id uuid, p_amount_units bigint, p_operation text, p_idempotency_key text, p_request_hash text, p_audit_action text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_from public.wallets%rowtype; v_to public.wallets%rowtype; v_response jsonb;
begin
  if p_from_user_id = p_to_user_id or p_amount_units <= 0 then raise exception 'invalid transfer'; end if;
  select * into v_record from public.idempotency_records where operation = p_operation and idempotency_key = p_idempotency_key for update;
  if found then
    if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if;
    return v_record.response;
  end if;
  -- Lock in stable UUID order to avoid opposite-direction transfer deadlocks.
  if p_from_user_id < p_to_user_id then
    select * into v_from from public.wallets where user_id = p_from_user_id for update;
    select * into v_to from public.wallets where user_id = p_to_user_id for update;
  else
    select * into v_to from public.wallets where user_id = p_to_user_id for update;
    select * into v_from from public.wallets where user_id = p_from_user_id for update;
  end if;
  if not found or v_from.id is null or v_to.id is null then raise exception 'wallet not found'; end if;
  if v_from.balance_units < p_amount_units then raise exception 'insufficient wallet balance'; end if;
  update public.wallets set balance_units = v_from.balance_units-p_amount_units, updated_at = now() where id = v_from.id;
  perform public.finance_write_wallet_ledger(p_from_user_id, v_from.id, null, null, case when p_operation = 'RECHARGE' then 'RECHARGE_DEBIT' else 'ADMIN_TRANSFER_DEBIT' end, -p_amount_units, v_from.balance_units, v_from.balance_units-p_amount_units, p_idempotency_key);
  update public.wallets set balance_units = v_to.balance_units+p_amount_units, updated_at = now() where id = v_to.id;
  perform public.finance_write_wallet_ledger(p_to_user_id, v_to.id, null, null, case when p_operation = 'RECHARGE' then 'RECHARGE_CREDIT' else 'ADMIN_TRANSFER_CREDIT' end, p_amount_units, v_to.balance_units, v_to.balance_units+p_amount_units, p_idempotency_key);
  if p_audit_action is not null then
    insert into public.audit_records(actor_user_id, target_user_id, action, resource_type, resource_id, metadata)
    values (p_from_user_id, p_to_user_id, p_audit_action, 'wallet_transfer', p_idempotency_key, jsonb_build_object('amount_units', p_amount_units));
  end if;
  v_response := jsonb_build_object('from_user_id', p_from_user_id, 'to_user_id', p_to_user_id, 'amount_units', p_amount_units, 'idempotent', false);
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values (p_operation, p_idempotency_key, p_request_hash, v_response);
  return v_response;
end;
$$;

create or replace function public.finance_create_recharge_request(p_requester_id uuid, p_target_user_id uuid, p_amount_units bigint, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.coin_recharge_requests%rowtype; v_requester public.users%rowtype; v_target public.users%rowtype; v_request public.coin_recharge_requests%rowtype;
begin
  if p_amount_units <= 0 or p_amount_units % 10 <> 0 then raise exception 'amount must be a positive whole displayed token amount'; end if;
  select * into v_existing from public.coin_recharge_requests where requester_id = p_requester_id and idempotency_key = p_idempotency_key for update;
  if found then return jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status, 'idempotent', true); end if;
  select * into v_requester from public.users where id = p_requester_id;
  select * into v_target from public.users where id = p_target_user_id;
  if not found or v_requester.status <> 'ACTIVE' or v_target.status <> 'ACTIVE' then raise exception 'active requester and target required'; end if;
  if v_requester.created_by <> p_target_user_id then raise exception 'recharge target must be the requester parent'; end if;
  insert into public.coin_recharge_requests(requester_id, target_user_id, amount, amount_units, status, idempotency_key)
  values (p_requester_id, p_target_user_id, p_amount_units / 10, p_amount_units, 'PENDING', p_idempotency_key) returning * into v_request;
  return jsonb_build_object('request_id', v_request.id, 'status', v_request.status, 'idempotent', false);
end;
$$;

create or replace function public.finance_approve_recharge_atomic(p_request_id uuid, p_actor_id uuid, p_idempotency_key text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.idempotency_records%rowtype; v_request public.coin_recharge_requests%rowtype; v_actor public.users%rowtype; v_result jsonb;
begin
  select * into v_record from public.idempotency_records where operation = 'RECHARGE_APPROVAL' and idempotency_key = p_idempotency_key for update;
  if found then if v_record.request_hash <> p_request_hash then raise exception 'idempotency key reused with a different request'; end if; return v_record.response; end if;
  select * into v_request from public.coin_recharge_requests where id = p_request_id for update;
  if not found then raise exception 'recharge request not found'; end if;
  if v_request.status = 'APPROVED' then raise exception 'approved recharge requires its original idempotency key'; end if;
  if v_request.status <> 'PENDING' then raise exception 'recharge request is not pending'; end if;
  select * into v_actor from public.users where id = p_actor_id;
  if not found or v_actor.status <> 'ACTIVE' or v_request.target_user_id <> p_actor_id then raise exception 'only the active direct parent may approve recharge'; end if;
  v_result := public.finance_transfer_atomic(v_request.target_user_id, v_request.requester_id, v_request.amount_units, 'RECHARGE', p_idempotency_key || ':transfer', p_request_hash, 'RECHARGE_APPROVED');
  update public.coin_recharge_requests set status = 'APPROVED', approved_by = p_actor_id, decided_at = now() where id = p_request.id;
  v_result := v_result || jsonb_build_object('request_id', p_request.id, 'status', 'APPROVED');
  insert into public.idempotency_records(operation, idempotency_key, request_hash, response) values ('RECHARGE_APPROVAL', p_idempotency_key, p_request_hash, v_result);
  return v_result;
end;
$$;

-- Legacy withdrawal data remains for historical compatibility but every
-- callable withdrawal route is disabled. This project has no redemption path.
create or replace function public.coin_create_withdrawal_request(uuid, numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ begin raise exception 'withdrawals are permanently disabled for virtual tokens'; end; $$;
create or replace function public.coin_approve_withdrawal_request(uuid, uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ begin raise exception 'withdrawals are permanently disabled for virtual tokens'; end; $$;
create or replace function public.coin_reject_withdrawal_request(uuid, uuid, text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ begin raise exception 'withdrawals are permanently disabled for virtual tokens'; end; $$;

revoke all on function public.finance_transfer_atomic(uuid,uuid,bigint,text,text,text,text) from public, anon, authenticated;
revoke all on function public.finance_create_recharge_request(uuid,uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.finance_approve_recharge_atomic(uuid,uuid,text,text) from public, anon, authenticated;
