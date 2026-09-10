import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function verify() {
  console.log('=== AUTHORIZATION VERIFICATION ===\n');
  
  // Check users table structure and roles
  const { data: users, error } = await supabase.from('users').select('*');
  if (error) {
    console.log('Error:', error.message);
    return;
  }
  
  console.log('Users in DB:');
  for (const u of users || []) {
    console.log(`  ${u.id} | ${u.user_code} | ${u.role} | ${u.created_by || 'NULL'} | ${u.status} | ${u.email}`);
  }
  
  console.log('\n=== WALLET VERIFICATION ===\n');
  const { data: wallets } = await supabase.from('wallets').select('*');
  for (const w of wallets || []) {
    console.log(`  Wallet: ${w.wallet_id} | User: ${w.user_id} | Balance: ${w.balance} | Version: ${w.version}`);
  }
  
  console.log('\n=== COIN SYSTEM ===\n');
  const { data: coin } = await supabase.from('coin_system').select('*');
  console.log('Coin system:', coin);
  
  console.log('\n=== RECHARGE REQUESTS ===\n');
  const { data: recharge } = await supabase.from('coin_recharge_requests').select('*');
  for (const r of recharge || []) {
    console.log(`  ${r.id} | Requester: ${r.requester_id} | Target: ${r.target_user_id} | Amount: ${r.amount} | Status: ${r.status}`);
  }
  
  console.log('\n=== ROULETTE DATA ===\n');
  const { data: rounds } = await supabase.from('roulette_rounds').select('*').order('round_number', { ascending: false }).limit(5);
  for (const r of rounds || []) {
    console.log(`  Round ${r.round_number}: ${r.status} | Result: ${r.result_number} ${r.result_color}`);
  }
  
  const { data: bets } = await supabase.from('roulette_bets').select('*').limit(10);
  for (const b of bets || []) {
    console.log(`  Bet: ${b.round_id} | Player: ${b.player_id} | Type: ${b.bet_type} | Value: ${b.bet_value} | Amount: ${b.amount} | Payout: ${b.payout} | Status: ${b.status}`);
  }
  
  // Test hierarchy: OWNER → SUPER_ADMIN → ADMIN → PLAYER
  console.log('\n=== HIERARCHY CHECK ===\n');
  const owner = users?.find(u => u.role === 'OWNER');
  const superAdmin = users?.find(u => u.role === 'SUPER_ADMIN');
  const admin = users?.find(u => u.role === 'ADMIN');
  const player = users?.find(u => u.role === 'PLAYER');
  
  console.log('OWNER created SUPER_ADMIN:', superAdmin?.created_by === owner?.id);
  console.log('SUPER_ADMIN created ADMIN:', admin?.created_by === superAdmin?.id);
  console.log('ADMIN created PLAYER:', player?.created_by === admin?.id);
  console.log('SUPER_ADMIN created PLAYER directly:', player?.created_by === superAdmin?.id);
}

verify().catch(console.error);
