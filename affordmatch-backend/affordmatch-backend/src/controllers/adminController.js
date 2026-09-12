"use strict";
const { query } = require("../config/db");

/** Platform-wide summary counts for the admin console landing page. */
async function getOverview(req, res) {
  const [users, listings, leads, wonDeals] = await Promise.all([
    query(`SELECT role, count(*)::int AS count FROM identity.users GROUP BY role`),
    query(`SELECT category, status, count(*)::int AS count FROM catalog.listings GROUP BY category, status`),
    query(`SELECT status, count(*)::int AS count FROM deals.leads GROUP BY status`),
    query(`SELECT count(*)::int AS count, coalesce(sum(price),0)::numeric AS total_value
           FROM deals.offers WHERE buyer_response = 'accepted'`)
  ]);
  res.json({
    usersByRole: users.rows,
    listingsByCategoryStatus: listings.rows,
    leadsByStatus: leads.rows,
    wonDeals: { count: wonDeals.rows[0].count, totalValue: Number(wonDeals.rows[0].total_value) }
  });
}

/** All providers, with their subscription status and listing/lead counts. */
async function listProviders(req, res) {
  const result = await query(
    `SELECT u.id, u.email, u.created_at, pp.company_name, pp.category,
            sub.plan, sub.status AS subscription_status, sub.current_period_end,
            (SELECT count(*) FROM catalog.listings cl WHERE cl.provider_id = u.id)::int AS listing_count,
            (SELECT count(*) FROM deals.leads dl WHERE dl.provider_id = u.id)::int AS lead_count
     FROM identity.users u
     JOIN identity.provider_profiles pp ON pp.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT plan, status, current_period_end FROM deals.subscriptions
       WHERE provider_id = u.id ORDER BY created_at DESC LIMIT 1
     ) sub ON TRUE
     ORDER BY u.created_at DESC`
  );
  res.json({ providers: result.rows });
}

/** All buyers, with a lead count. */
async function listBuyers(req, res) {
  const result = await query(
    `SELECT u.id, u.email, u.created_at, bp.full_name,
            (SELECT count(*) FROM deals.leads dl WHERE dl.buyer_id = u.id)::int AS lead_count
     FROM identity.users u
     JOIN identity.buyer_profiles bp ON bp.user_id = u.id
     ORDER BY u.created_at DESC`
  );
  res.json({ buyers: result.rows });
}

/** All leads platform-wide, for moderation / intervention. */
async function listAllLeads(req, res) {
  const result = await query(
    `SELECT ld.id, ld.status, ld.match_score, ld.created_at,
            l.title AS listing_title, l.category,
            bp.full_name AS buyer_name, pp.company_name AS provider_name
     FROM deals.leads ld
     JOIN catalog.listings l ON l.id = ld.listing_id
     JOIN identity.buyer_profiles bp ON bp.user_id = ld.buyer_id
     JOIN identity.provider_profiles pp ON pp.user_id = ld.provider_id
     ORDER BY ld.created_at DESC
     LIMIT 200`
  );
  res.json({ leads: result.rows });
}

/** Deactivate a user account (buyer or provider) — soft delete, not a hard DELETE. */
async function deactivateUser(req, res) {
  await query(`UPDATE identity.users SET is_active = FALSE WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}

module.exports = { getOverview, listProviders, listBuyers, listAllLeads, deactivateUser };
