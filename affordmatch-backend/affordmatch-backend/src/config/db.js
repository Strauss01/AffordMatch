"use strict";
const { Pool } = require("pg");

// Supabase (and most managed Postgres providers) require SSL, and typically
// present a certificate that isn't in Node's default trust store — hence
// rejectUnauthorized: false rather than a plain `ssl: true`. Set DB_SSL=false
// to disable entirely for a local/unencrypted Postgres in dev.
const useSsl = process.env.DB_SSL !== "false";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

pool.on("error", (err) => {
  // a background/idle client errored — log and let the pool recover
  console.error("Unexpected error on idle Postgres client", err);
});

/** Run a query with a fresh client from the pool. */
function query(text, params) {
  return pool.query(text, params);
}

/** Run a callback inside a transaction; commits on success, rolls back on throw. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
