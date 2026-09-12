"use strict";

/**
 * SSL options for a raw pg.Client connection (used by migrate.js and
 * seed.js). Supabase and most managed Postgres providers require SSL with
 * a certificate not in Node's default trust store, hence
 * rejectUnauthorized: false rather than a plain `ssl: true`.
 * Set DB_SSL=false for a local/unencrypted Postgres in dev.
 */
function pgClientOptions() {
  const useSsl = process.env.DB_SSL !== "false";
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  };
}

module.exports = { pgClientOptions };
