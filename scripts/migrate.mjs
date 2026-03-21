#!/usr/bin/env node
/**
 * Run Supabase migrations using the Supabase client with service role key.
 * Creates an exec_sql function first, then uses it to run migrations.
 *
 * Usage: node scripts/migrate.mjs
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Load env from .env.local
function loadEnv() {
  try {
    const content = readFileSync(join(rootDir, ".env.local"), "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^#=]+)=(.+)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {}
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

async function runMigration(name, sql) {
  // Split on semicolons but preserve function bodies ($$...$$)
  const statements = splitStatements(sql);

  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed || trimmed === "") continue;

    try {
      const { error } = await supabase.rpc("exec_sql", { sql_text: trimmed });
      if (error) {
        // If exec_sql doesn't exist yet, we need a different approach
        if (error.message.includes("exec_sql")) {
          return "needs_bootstrap";
        }
        if (error.message.includes("already exists")) {
          continue; // Skip already-existing objects
        }
        throw error;
      }
    } catch (err) {
      if (err.message?.includes("already exists")) continue;
      throw err;
    }
  }
  return "ok";
}

function splitStatements(sql) {
  // Simple splitter that respects $$ blocks
  const results = [];
  let current = "";
  let inDollarQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];

    if (sql.slice(i, i + 2) === "$$") {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i++;
      continue;
    }

    if (char === ";" && !inDollarQuote) {
      if (current.trim()) results.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) results.push(current.trim());
  return results;
}

async function bootstrap() {
  // Create the exec_sql helper function via direct REST call
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql_text: "SELECT 1" }),
  });

  if (response.status === 404 || (await response.text()).includes("Could not find")) {
    // Need to create the function via SQL editor or find another way
    return false;
  }
  return true;
}

async function runViaDirect() {
  // Use Supabase's built-in pg_net or the SQL API
  const migrationsDir = join(rootDir, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

  // Combine all SQL into one big statement
  let allSQL = "";
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    allSQL += `-- ${f}\n${sql}\n\n`;
  }

  // Try using the Supabase SQL endpoint (available in newer versions)
  const endpoints = [
    "/pg/query",
    "/rest/v1/rpc/exec_sql",
  ];

  for (const endpoint of endpoints) {
    const response = await fetch(`${supabaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ query: allSQL, sql_text: allSQL }),
    });

    if (response.ok) {
      console.log(`✓ Migrations executed via ${endpoint}`);
      return true;
    }
  }

  return false;
}

async function main() {
  console.log("SkillBenchmark Database Migration");
  console.log("=================================\n");

  const migrationsDir = join(rootDir, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  console.log(`Found ${files.length} migration files\n`);

  // Try direct execution first
  const directResult = await runViaDirect();
  if (directResult) {
    console.log("\n✓ All migrations applied successfully!");
    return;
  }

  // If that didn't work, output instructions
  console.log("⚠ Could not execute migrations programmatically.");
  console.log("  Supabase requires the SQL Editor for DDL statements.\n");

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  console.log("Please paste the SQL into the Supabase SQL Editor:");
  console.log(`→ https://supabase.com/dashboard/project/${projectRef}/sql/new\n`);

  // Write combined SQL to a file for easy copy
  let combined = "";
  for (const f of files) {
    combined += `-- ${f}\n${readFileSync(join(migrationsDir, f), "utf8")}\n\n`;
  }

  const outputPath = join(rootDir, "supabase", "combined_migration.sql");
  const { writeFileSync } = await import("fs");
  writeFileSync(outputPath, combined);
  console.log(`Combined SQL written to: supabase/combined_migration.sql`);
  console.log("Copy and paste the contents into the SQL Editor and click Run.");
}

main().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
