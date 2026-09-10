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
  // First create exec_sql function
  console.log('Creating exec_sql function...');
  const execSql = `
    CREATE OR REPLACE FUNCTION exec_sql(sql text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      EXECUTE sql;
    END;
    $$;
    
    GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
  `;
  
  // Try to create it via direct REST API or check if we can use the Supabase client
  // First try using the management API
  try {
    const response = await fetch(`${url}/rest/v1/`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ query: execSql })
    });
    console.log('Direct query attempt:', response.status);
  } catch (e) {
    console.log('Direct query failed:', e.message);
  }
  
  // Try using rpc with postgres
  const { error } = await supabase.rpc('exec_sql', { sql: execSql });
  if (error) {
    console.log('Could not create exec_sql:', error.message);
  }
  
  // Try to run migrations via direct query on the Supabase PostgREST
  const files = readdirSync(join(process.cwd(), 'supabase/migrations'))
    .filter(f => f.endsWith('.sql') && !f.includes('.backup'))
    .sort();
  
  console.log(`Found ${files.length} migrations to apply\n`);
  
  for (const filename of files) {
    console.log(`Applying: ${filename}...`);
    
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations', filename), 'utf-8');
    
    // Try direct PostgREST query
    const response = await fetch(`${url}/rest/v1/`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ query: sql })
    });
    
    if (response.ok) {
      console.log(`  Done`);
    } else {
      const err = await response.text();
      console.log(`  ERROR: ${err.substring(0, 300)}`);
    }
  }
  
  console.log('\n=== Verification after migrations ===');
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
