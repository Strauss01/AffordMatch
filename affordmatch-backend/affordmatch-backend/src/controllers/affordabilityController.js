"use strict";
const { query, withTransaction } = require("../config/db");
const { computeAffordability } = require("../services/matchingEngine");
const { affordabilitySchema } = require("../validators/schemas");
const { ApiError } = require("../middleware/errorHandler");

/** Buyer submits new affordability inputs; we store the inputs AND the computed snapshot. */
async function submitAffordability(req, res) {
  const input = affordabilitySchema.parse(req.body);
  const envelope = computeAffordability(input);

  const { profile, snapshot } = await withTransaction(async (client) => {
    const profileRes = await client.query(
      `INSERT INTO afford.profiles (buyer_id, mode, gross_income, monthly_debts, deposit, interest_rate, term_months)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, input.mode, input.grossIncome, input.monthlyDebts, input.deposit, input.interestRate, input.termMonths]
    );
    const newProfile = profileRes.rows[0];

    const snapshotRes = await client.query(
      `INSERT INTO afford.snapshots (profile_id, max_monthly_payment, min_price, max_price, over_committed)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [newProfile.id, envelope.maxMonthlyPayment, envelope.minPrice, envelope.maxPrice, envelope.overCommitted]
    );
    return { profile: newProfile, snapshot: snapshotRes.rows[0] };
  });

  res.status(201).json({
    profile: serializeProfile(profile),
    envelope: serializeSnapshot(snapshot)
  });
}

/** Fetch the buyer's current (most recent) affordability snapshot for a mode. */
async function getCurrentAffordability(req, res) {
  const { mode } = req.query;
  if (mode !== "auto" && mode !== "property") {
    throw new ApiError(400, "Query param 'mode' must be 'auto' or 'property'");
  }
  const result = await query(
    `SELECT * FROM afford.current_snapshot WHERE buyer_id = $1 AND mode = $2`,
    [req.user.id, mode]
  );
  if (!result.rows[0]) {
    return res.json({ envelope: null });
  }
  const row = result.rows[0];
  res.json({
    envelope: {
      profileId: row.profile_id,
      snapshotId: row.snapshot_id,
      mode: row.mode,
      grossIncome: Number(row.gross_income),
      monthlyDebts: Number(row.monthly_debts),
      deposit: Number(row.deposit),
      interestRate: Number(row.interest_rate),
      termMonths: row.term_months,
      maxMonthlyPayment: Number(row.max_monthly_payment),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      overCommitted: row.over_committed,
      computedAt: row.computed_at
    }
  });
}

function serializeProfile(p) {
  return {
    id: p.id,
    mode: p.mode,
    grossIncome: Number(p.gross_income),
    monthlyDebts: Number(p.monthly_debts),
    deposit: Number(p.deposit),
    interestRate: Number(p.interest_rate),
    termMonths: p.term_months,
    createdAt: p.created_at
  };
}
function serializeSnapshot(s) {
  return {
    id: s.id,
    profileId: s.profile_id,
    maxMonthlyPayment: Number(s.max_monthly_payment),
    minPrice: Number(s.min_price),
    maxPrice: Number(s.max_price),
    overCommitted: s.over_committed,
    computedAt: s.computed_at
  };
}

module.exports = { submitAffordability, getCurrentAffordability };
