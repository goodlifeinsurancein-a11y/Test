import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

config();

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function applyMigrations() {
  // Get all migration files in order
  const files = readdirSync(join(process.cwd(), 'supabase/migrations'))
    .filter(f => f.endsWith('.sql') && !f.includes('.backup'))
    .sort();
  
  console.log(`Found ${files.length} migrations to apply\n`);
  
  for (const filename of files) {
    console.log(`Applying: ${filename}...`);
    
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations', filename), 'utf-8');
    
    // Execute entire migration as one RPC call
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) {
      console.log(`  ERROR: ${error.message.substring(0, 200)}`);
    } else {
      console.log(`  Done`);
    }
  }
  
  console.log('\n=== Verification after migrations ===');
  
  // Verify tables
  const tables = [
    'wallets', 'game_wallets', 'coin_supply', 'game_rounds', 'game_bets',
    'game_settlements', 'wallet_transactions', 'idempotency_records',
    'audit_records', 'coin_recharge_requests', 'crash_server_secret',
    'game_payout_caps', 'engine_leases'
  ];
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    console.log(`Table ${table}: ${error ? 'MISSING - ' + error.message : 'EXISTS'}`);
  }
}

applyMigrations().catch(console.error);
