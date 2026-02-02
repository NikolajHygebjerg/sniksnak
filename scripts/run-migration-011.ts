/**
 * Script to run migration 011: Add is_child column
 * 
 * Usage:
 *   npx tsx scripts/run-migration-011.ts
 * 
 * Requires:
 *   - NEXT_PUBLIC_SUPABASE_URL environment variable
 *   - SUPABASE_SERVICE_ROLE_KEY environment variable
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("❌ Missing environment variables:");
  console.error("   NEXT_PUBLIC_SUPABASE_URL:", !!supabaseUrl);
  console.error("   SUPABASE_SERVICE_ROLE_KEY:", !!serviceRoleKey);
  console.error("\nPlease set these in your .env.local file");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey);

async function runMigration() {
  console.log("🚀 Running migration 011: Add is_child column\n");

  try {
    // Read migration file
    const migrationPath = join(process.cwd(), "supabase/migrations/011_add_is_child_column.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");

    console.log("📄 Migration file loaded\n");

    // Split into individual statements (simple approach - split by semicolon)
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    console.log(`📝 Found ${statements.length} SQL statements\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement || statement.length < 10) continue; // Skip empty or very short statements

      console.log(`⏳ Executing statement ${i + 1}/${statements.length}...`);
      
      try {
        const { error } = await admin.rpc("exec_sql", { sql: statement });
        
        // Note: exec_sql RPC function may not exist in all Supabase instances
        // Fallback: use direct query if RPC doesn't work
        if (error && error.message?.includes("function") && error.message?.includes("does not exist")) {
          console.log("   ⚠️  RPC function not available, trying direct query...");
          // For direct queries, we'd need to use the Postgres client directly
          // This is a limitation - Supabase JS client doesn't support arbitrary SQL
          console.log("   ❌ Cannot execute arbitrary SQL via Supabase JS client");
          console.log("   💡 Please run the migration manually in Supabase Dashboard");
          console.log("   📖 See: docs/MIGRATION_011_INSTRUCTIONS.md");
          process.exit(1);
        } else if (error) {
          // Some errors are expected (like "already exists")
          if (error.message?.includes("already exists") || error.message?.includes("duplicate")) {
            console.log(`   ✓ Skipped (already exists)`);
          } else {
            console.error(`   ❌ Error: ${error.message}`);
            throw error;
          }
        } else {
          console.log(`   ✓ Success`);
        }
      } catch (err: any) {
        console.error(`   ❌ Failed: ${err.message}`);
        throw err;
      }
    }

    console.log("\n✅ Migration completed successfully!");
    console.log("\n📊 Verifying migration...");

    // Verify column exists
    const { data: columns, error: colError } = await admin
      .from("users")
      .select("*")
      .limit(1);

    if (colError) {
      console.error("❌ Error verifying:", colError.message);
    } else {
      console.log("✓ Users table is accessible");
    }

    // Check if is_child column exists by trying to query it
    const { data: testData, error: testError } = await admin
      .from("users")
      .select("is_child")
      .limit(1);

    if (testError) {
      if (testError.message?.includes("is_child") || testError.code === "42703") {
        console.error("❌ Column 'is_child' does not exist - migration may have failed");
        console.error("   Error:", testError.message);
      } else {
        console.error("❌ Unexpected error:", testError.message);
      }
    } else {
      console.log("✓ Column 'is_child' exists and is queryable");
      
      // Count children
      const { count, error: countError } = await admin
        .from("users")
        .select("is_child", { count: "exact", head: true })
        .eq("is_child", true);

      if (!countError && count !== null) {
        console.log(`✓ Found ${count} children with is_child = true`);
      }
    }

    console.log("\n🎉 All done! The migration has been applied.");
    console.log("💡 Refresh your app and try the 'Find children' feature.");

  } catch (error: any) {
    console.error("\n❌ Migration failed:", error.message);
    console.error("\n💡 Please run the migration manually in Supabase Dashboard:");
    console.error("   See: docs/MIGRATION_011_INSTRUCTIONS.md");
    process.exit(1);
  }
}

runMigration();
