import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

config();

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;

// Use the Supabase client with the service role key
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// We'll execute raw SQL via a stored procedure we create
// First, let's check if we can use the PostgREST RPC endpoint for raw SQL
// Actually, we can't. We need to use the Supabase Management API or direct DB connection.

// Alternative: Use the Supabase REST API to create a function that executes SQL
// This requires the `sql` extension which may not be available

// Let me try a different approach - check what RPCs exist and try to use them
async function checkExistingSchema() {
  console.log('Checking existing schema via information_schema...\n');
  
  const { data, error } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public');
  
  if (error) {
    console.log('Error querying information_schema:', error.message);
    return;
  }
  
  console.log('Existing tables:');
  for (const row of data || []) {
    console.log(`  ${row.table_name}`);
  }
  
  // Check functions
  const { data: funcs, error: funcError } = await supabase
    .from('information_schema.routines')
    .select('routine_name')
    .eq('routine_schema', 'public')
    .like('routine_name', 'finance%');
  
  if (funcError) {
    console.log('Error querying functions:', funcError.message);
  } else {
    console.log('\nFinance functions:');
    for (const row of funcs || []) {
      console.log(`  ${row.routine_name}`);
    }
  }
}

checkExistingSchema().catch(console.error);
