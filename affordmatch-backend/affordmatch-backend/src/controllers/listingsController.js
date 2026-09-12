"use strict";
const { query } = require("../config/db");
const { rankListings } = require("../services/matchingEngine");
const { createListingSchema, updateListingSchema } = require("../validators/schemas");
const { ApiError } = require("../middleware/errorHandler");

/** Public: list active listings for a category (no matching applied). */
async function listPublicListings(req, res) {
  const { category } = req.query;
  if (category !== "auto" && category !== "property") {
    throw new ApiError(400, "Query param 'category' must be 'auto' or 'property'");
  }
  const result = await query(
    `SELECT l.*, p.company_name AS provider_name
     FROM catalog.listings l
     JOIN identity.provider_profiles p ON p.user_id = l.provider_id
     WHERE l.category = $1 AND l.status = 'active'
     ORDER BY l.created_at DESC`,
    [category]
  );
  res.json({ listings: result.rows.map(serializeListing) });
}

/**
 * Buyer: matched + scored listings against their current affordability
 * snapshot. This is the core "affordability -> matching" endpoint.
 */
async function getMatches(req, res) {
  const { mode } = req.query;
  if (mode !== "auto" && mode !== "property") {
    throw new ApiError(400, "Query param 'mode' must be 'auto' or 'property'");
  }

  const snapRes = await query(
    `SELECT * FROM afford.current_snapshot WHERE buyer_id = $1 AND mode = $2`,
    [req.user.id, mode]
  );
  const snap = snapRes.rows[0];
  if (!snap) {
    throw new ApiError(404, "Submit an affordability profile for this mode before requesting matches");
  }

  const listingsRes = await query(
    `SELECT id, price FROM catalog.listings WHERE category = $1 AND status = 'active'`,
    [mode]
  );

  const ranked = rankListings(
    listingsRes.rows.map((r) => ({ id: r.id, price: Number(r.price) })),
    { deposit: Number(snap.deposit), interestRate: Number(snap.interest_rate), termMonths: snap.term_months },
    { maxMonthlyPayment: Number(snap.max_monthly_payment) }
  );

  if (ranked.length === 0) {
    return res.json({ snapshotId: snap.snapshot_id, matches: [] });
  }

  // hydrate full listing rows for the ranked ids, then re-apply score/estimatedPayment/ordering
  const ids = ranked.map((r) => r.id);
  const fullRes = await query(
    `SELECT l.*, p.company_name AS provider_name
     FROM catalog.listings l
     JOIN identity.provider_profiles p ON p.user_id = l.provider_id
     WHERE l.id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = Object.fromEntries(fullRes.rows.map((r) => [r.id, r]));

  const matches = ranked.map((r) => ({
    ...serializeListing(byId[r.id]),
    score: r.score,
    estimatedPayment: r.estimatedPayment
  }));

  // fire-and-forget match_events log (doesn't block the response)
  if (matches.length) {
    query(
      `INSERT INTO catalog.match_events (buyer_id, listing_id, snapshot_id, score, estimated_payment)
       SELECT * FROM (VALUES ${matches
         .map((_, i) => `($${i * 5 + 1}::uuid, $${i * 5 + 2}::uuid, $${i * 5 + 3}::uuid, $${i * 5 + 4}::smallint, $${i * 5 + 5}::numeric)`)
         .join(",")}) AS v(buyer_id, listing_id, snapshot_id, score, estimated_payment)`,
      matches.flatMap((m) => [req.user.id, m.id, snap.snapshot_id, m.score, m.estimatedPayment])
    ).catch((err) => console.error("match_events log failed", err));
  }

  res.json({ snapshotId: snap.snapshot_id, matches });
}

/** Provider: create a listing. */
async function createListing(req, res) {
  const input = createListingSchema.parse(req.body);
  const result = await query(
    `INSERT INTO catalog.listings (provider_id, category, title, location, price, metadata)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, input.category, input.title, input.location || null, input.price, JSON.stringify(input.metadata || {})]
  );
  res.status(201).json({ listing: serializeListing(result.rows[0]) });
}

/** Provider: list own inventory. */
async function listOwnListings(req, res) {
  const result = await query(
    `SELECT * FROM catalog.listings WHERE provider_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json({ listings: result.rows.map(serializeListing) });
}

/** Provider: update own listing (price, status, etc). */
async function updateListing(req, res) {
  const input = updateListingSchema.parse(req.body);
  const owned = await query(`SELECT id FROM catalog.listings WHERE id = $1 AND provider_id = $2`, [
    req.params.id,
    req.user.id
  ]);
  if (!owned.rows[0]) throw new ApiError(404, "Listing not found");

  const fields = [];
  const values = [];
  let i = 1;
  for (const [key, col] of Object.entries({
    title: "title",
    location: "location",
    price: "price",
    status: "status",
    metadata: "metadata"
  })) {
    if (input[key] !== undefined) {
      fields.push(`${col} = $${i}`);
      values.push(key === "metadata" ? JSON.stringify(input[key]) : input[key]);
      i++;
    }
  }
  if (fields.length === 0) throw new ApiError(400, "No fields to update");
  values.push(req.params.id);

  const result = await query(
    `UPDATE catalog.listings SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  res.json({ listing: serializeListing(result.rows[0]) });
}

function serializeListing(row) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    category: row.category,
    title: row.title,
    location: row.location,
    price: Number(row.price),
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

module.exports = { listPublicListings, getMatches, createListing, listOwnListings, updateListing };
