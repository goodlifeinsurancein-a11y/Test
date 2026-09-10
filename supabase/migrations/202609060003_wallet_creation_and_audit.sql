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

revoke all on function public.finance_create_wallet(uuid,text) from public, anon, authenticated;
revoke all on function public.finance_audit(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.finance_write_wallet_ledger(uuid,uuid,text,uuid,text,bigint,bigint,bigint,text) from public, anon, authenticated;
revoke all on function public.finance_write_pool_ledger(uuid,text,uuid,text,bigint,bigint,bigint,text) from public, anon, authenticated;
