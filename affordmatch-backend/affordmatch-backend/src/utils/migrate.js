"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { pgClientOptions } = require("./dbClientOptions");

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.join(__dirname, "..", "..", "db", "migrations");

async function main() {
  const client = new Client(pgClientOptions());
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query(`SELECT filename FROM public.schema_migrations`)).rows.map((r) => r.filename)
  );

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`apply ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(`INSERT INTO public.schema_migrations (filename) VALUES ($1)`, [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED applying ${file}`);
      throw err;
    }
  }

  console.log("Migrations up to date.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
