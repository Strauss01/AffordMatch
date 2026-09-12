"use strict";
const { query, withTransaction } = require("../config/db");
const { scoreListing } = require("../services/matchingEngine");
const {
  createLeadSchema,
  updateLeadStatusSchema,
  createOfferSchema,
  offerResponseSchema
} = require("../validators/schemas");
const { ApiError } = require("../middleware/errorHandler");

/** Buyer: "Request offer" — creates a lead against the buyer's current snapshot for that listing's category. */
async function createLead(req, res) {
  const input = createLeadSchema.parse(req.body);

  const listingRes = await query(`SELECT * FROM catalog.listings WHERE id = $1 AND status = 'active'`, [
    input.listingId
  ]);
  const listing = listingRes.rows[0];
  if (!listing) throw new ApiError(404, "Listing not found or no longer active");

  const snapRes = await query(
    `SELECT * FROM afford.current_snapshot WHERE buyer_id = $1 AND mode = $2`,
    [req.user.id, listing.category]
  );
  const snap = snapRes.rows[0];
  if (!snap) throw new ApiError(400, "Submit an affordability profile for this category before requesting an offer");

  const { score } = scoreListing(
    Number(listing.price),
    { deposit: Number(snap.deposit), interestRate: Number(snap.interest_rate), termMonths: snap.term_months },
    { maxMonthlyPayment: Number(snap.max_monthly_payment) }
  );

  const lead = await withTransaction(async (client) => {
    const leadRes = await client.query(
      `INSERT INTO deals.leads (buyer_id, provider_id, listing_id, snapshot_id, match_score, status)
       VALUES ($1, $2, $3, $4, $5, 'new') RETURNING *`,
      [req.user.id, listing.provider_id, listing.id, snap.snapshot_id, score]
    );
    const newLead = leadRes.rows[0];
    await client.query(
      `INSERT INTO deals.status_history (lead_id, from_status, to_status, changed_by)
       VALUES ($1, NULL, 'new', $2)`,
      [newLead.id, req.user.id]
    );
    return newLead;
  });

  res.status(201).json({ lead: serializeLead(lead) });
}

/** Buyer: list their own requests, with listing + offer joined in. */
async function listMyLeads(req, res) {
  const result = await query(
    `SELECT ld.*, l.title, l.price AS listing_price, l.category, pp.company_name AS provider_name,
            o.id AS offer_id, o.price AS offer_price, o.monthly_payment AS offer_monthly,
            o.notes AS offer_notes, o.buyer_response, o.created_at AS offer_created_at
     FROM deals.leads ld
     JOIN catalog.listings l ON l.id = ld.listing_id
     JOIN identity.provider_profiles pp ON pp.user_id = ld.provider_id
     LEFT JOIN deals.offers o ON o.lead_id = ld.id
     WHERE ld.buyer_id = $1
     ORDER BY ld.created_at DESC`,
    [req.user.id]
  );
  res.json({ leads: result.rows.map(serializeLeadWithJoins) });
}

/** Provider: list leads for their own inventory, with buyer's affordability snapshot. */
async function listProviderLeads(req, res) {
  const result = await query(
    `SELECT ld.*, l.title, l.price AS listing_price, l.category,
            bp.full_name AS buyer_name, u.email AS buyer_email, u.phone AS buyer_phone,
            s.min_price AS snap_min_price, s.max_price AS snap_max_price, s.max_monthly_payment AS snap_max_payment,
            o.id AS offer_id, o.price AS offer_price, o.monthly_payment AS offer_monthly, o.buyer_response
     FROM deals.leads ld
     JOIN catalog.listings l ON l.id = ld.listing_id
     JOIN identity.buyer_profiles bp ON bp.user_id = ld.buyer_id
     JOIN identity.users u ON u.id = ld.buyer_id
     JOIN afford.snapshots s ON s.id = ld.snapshot_id
     LEFT JOIN deals.offers o ON o.lead_id = ld.id
     WHERE ld.provider_id = $1
     ORDER BY ld.created_at DESC`,
    [req.user.id]
  );
  res.json({ leads: result.rows.map(serializeProviderLead) });
}

/** Provider: advance a lead's status (drives the qualified-lead dashboard). */
async function updateLeadStatus(req, res) {
  const input = updateLeadStatusSchema.parse(req.body);

  const owned = await query(`SELECT * FROM deals.leads WHERE id = $1 AND provider_id = $2`, [
    req.params.id,
    req.user.id
  ]);
  const lead = owned.rows[0];
  if (!lead) throw new ApiError(404, "Lead not found");

  const updated = await withTransaction(async (client) => {
    const res2 = await client.query(`UPDATE deals.leads SET status = $1 WHERE id = $2 RETURNING *`, [
      input.status,
      lead.id
    ]);
    await client.query(
      `INSERT INTO deals.status_history (lead_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4)`,
      [lead.id, lead.status, input.status, req.user.id]
    );
    return res2.rows[0];
  });

  res.json({ lead: serializeLead(updated) });
}

/** Provider: submit an offer on a lead; sets lead status to offer_sent. */
async function createOffer(req, res) {
  const input = createOfferSchema.parse(req.body);

  const owned = await query(`SELECT * FROM deals.leads WHERE id = $1 AND provider_id = $2`, [
    req.params.id,
    req.user.id
  ]);
  const lead = owned.rows[0];
  if (!lead) throw new ApiError(404, "Lead not found");

  const offer = await withTransaction(async (client) => {
    const offerRes = await client.query(
      `INSERT INTO deals.offers (lead_id, price, monthly_payment, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [lead.id, input.price, input.monthlyPayment, input.notes || null]
    );
    await client.query(`UPDATE deals.leads SET status = 'offer_sent' WHERE id = $1`, [lead.id]);
    await client.query(
      `INSERT INTO deals.status_history (lead_id, from_status, to_status, changed_by) VALUES ($1, $2, 'offer_sent', $3)`,
      [lead.id, lead.status, req.user.id]
    );
    return offerRes.rows[0];
  });

  res.status(201).json({ offer: serializeOffer(offer) });
}

/** Buyer: accept or decline an offer; drives lead to won/lost. */
async function respondToOffer(req, res) {
  const input = offerResponseSchema.parse(req.body);

  const offerRes = await query(
    `SELECT o.*, ld.buyer_id, ld.id AS lead_id, ld.status AS lead_status
     FROM deals.offers o JOIN deals.leads ld ON ld.id = o.lead_id
     WHERE o.id = $1`,
    [req.params.id]
  );
  const offer = offerRes.rows[0];
  if (!offer || offer.buyer_id !== req.user.id) throw new ApiError(404, "Offer not found");

  const newLeadStatus = input.response === "accepted" ? "won" : "lost";

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE deals.offers SET buyer_response = $1, responded_at = now() WHERE id = $2`,
      [input.response, offer.id]
    );
    await client.query(`UPDATE deals.leads SET status = $1 WHERE id = $2`, [newLeadStatus, offer.lead_id]);
    await client.query(
      `INSERT INTO deals.status_history (lead_id, from_status, to_status, changed_by) VALUES ($1, $2, $3, $4)`,
      [offer.lead_id, offer.lead_status, newLeadStatus, req.user.id]
    );
  });

  res.json({ status: newLeadStatus });
}

function serializeLead(row) {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    providerId: row.provider_id,
    listingId: row.listing_id,
    snapshotId: row.snapshot_id,
    matchScore: row.match_score,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeLeadWithJoins(row) {
  return {
    ...serializeLead(row),
    listingTitle: row.title,
    listingPrice: Number(row.listing_price),
    category: row.category,
    providerName: row.provider_name,
    offer: row.offer_id
      ? {
          id: row.offer_id,
          price: Number(row.offer_price),
          monthlyPayment: Number(row.offer_monthly),
          notes: row.offer_notes,
          buyerResponse: row.buyer_response,
          createdAt: row.offer_created_at
        }
      : null
  };
}

function serializeProviderLead(row) {
  return {
    ...serializeLead(row),
    listingTitle: row.title,
    listingPrice: Number(row.listing_price),
    category: row.category,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    buyerPhone: row.buyer_phone,
    affordabilitySnapshot: {
      minPrice: Number(row.snap_min_price),
      maxPrice: Number(row.snap_max_price),
      maxMonthlyPayment: Number(row.snap_max_payment)
    },
    offer: row.offer_id
      ? {
          id: row.offer_id,
          price: Number(row.offer_price),
          monthlyPayment: Number(row.offer_monthly),
          buyerResponse: row.buyer_response
        }
      : null
  };
}

function serializeOffer(row) {
  return {
    id: row.id,
    leadId: row.lead_id,
    price: Number(row.price),
    monthlyPayment: Number(row.monthly_payment),
    notes: row.notes,
    buyerResponse: row.buyer_response,
    createdAt: row.created_at
  };
}

module.exports = {
  createLead,
  listMyLeads,
  listProviderLeads,
  updateLeadStatus,
  createOffer,
  respondToOffer
};
