import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function verify() {
  console.log('=== VERIFYING DATABASE SCHEMA ===\n');
  
  // 1. Check tables exist
  const tables = [
    'wallets', 'game_wallets', 'coin_supply', 'game_rounds', 'game_bets',
    'game_settlements', 'wallet_transactions', 'idempotency_records',
    'audit_records', 'users', 'coin_recharge_requests', 'crash_server_secret',
    'game_payout_caps', 'engine_leases'
  ];
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    console.log(`Table ${table}: ${error ? 'MISSING/ERROR - ' + error.message : 'EXISTS'}`);
  }
  
  // 2. Check game_rounds status constraint
  const { data: rounds } = await supabase.from('game_rounds').select('status').limit(10);
  const statuses = [...new Set(rounds?.map(r => r.status) || [])];
  console.log('\nActual game_rounds statuses in DB:', statuses.join(', '));
  
  // 3. Check RPCs exist
  const rpcs = [
    'finance_open_round',
    'finance_place_bet_atomic',
    'finance_settle_bet_atomic',
    'finance_record_round_result',
    'finance_advance_crash_round',
    'finance_generate_crash_point',
    'finance_crash_cashout_atomic',
    'finance_auto_settle_crash_round',
    'finance_transfer_atomic',
    'finance_create_recharge_request',
    'finance_approve_recharge_atomic',
    'finance_acquire_round_lock',
    'finance_release_round_lock',
    'finance_acquire_engine_lease',
    'finance_release_engine_lease',
    'finance_mark_interrupted_rounds_for_recovery',
    'finance_recover_crash_round',
    'wallet_debit_atomic',
    'wallet_credit_atomic',
    'create_user_profile',
    'create_user_wallet'
  ];
  
  console.log('\n=== RPC VERIFICATION ===');
  for (const rpc of rpcs) {
    try {
      const { error } = await supabase.rpc(rpc, {});
      const exists = !error || !error.message.includes('does not exist');
      console.log(`RPC ${rpc}: ${exists ? 'EXISTS' : 'MISSING'}`);
    } catch (e) {
      console.log(`RPC ${rpc}: ERROR - ${e}`);
    }
  }
  
  // 4. Check coin_supply
  const { data: supply } = await supabase.from('coin_supply').select('*').single();
  console.log('\nCoin supply:', supply);
  
  // 5. Check game_payout_caps
  const { data: caps } = await supabase.from('game_payout_caps').select('*');
  console.log('\nPayout caps:', caps);
  
  // 6. Check crash_server_secret
  const { data: secret } = await supabase.from('crash_server_secret').select('singleton, secret').single();
  console.log('\nCrash server secret exists:', !!secret?.secret);
  
  // 7. Check RLS
  const { data: rls } = await supabase.rpc('finance_open_round', { p_round_id: '00000000-0000-0000-0000-000000000000', p_game_key: 'crash', p_round_number: 1, p_status: 'BETTING', p_started_at: new Date().toISOString(), p_betting_ends_at: new Date().toISOString() });
  console.log('\nService-role RPC test:', rls?.error ? 'BLOCKED (expected for anon)' : 'ALLOWED');
}

verify().catch(console.error);
