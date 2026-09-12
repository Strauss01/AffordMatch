"use strict";
/**
 * Integration smoke test — hits the running server over HTTP and walks the
 * full loop: buyer registers -> submits affordability -> sees matches ->
 * requests an offer -> provider sees the qualified lead -> provider submits
 * an offer -> buyer accepts -> admin sees the won deal in the overview.
 *
 * Run with the server already started: node tests/integration.smoke.js
 */
const BASE = "http://localhost:4000";

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok:", msg);
}

async function main() {
  const stamp = Date.now();

  console.log("1. Register a new buyer");
  const buyerEmail = `buyer.${stamp}@test.dev`;
  const buyerReg = await api("POST", "/api/auth/register/buyer", {
    body: { email: buyerEmail, password: "Password123!", fullName: "Test Buyer" }
  });
  assert(buyerReg.token, "buyer got a JWT on registration");
  const buyerToken = buyerReg.token;

  console.log("2. Log in as an existing seeded provider (auto)");
  const providerLogin = await api("POST", "/api/auth/login", {
    body: { email: "johannesburg-toyota@affordmatch.dev", password: "Password123!" }
  });
  assert(providerLogin.token, "provider logged in");
  const providerToken = providerLogin.token;

  console.log("3. Log in as admin");
  const adminLogin = await api("POST", "/api/auth/login", {
    body: { email: "admin@affordmatch.dev", password: "Password123!" }
  });
  const adminToken = adminLogin.token;

  console.log("4. Buyer submits affordability for 'auto'");
  const afford = await api("POST", "/api/buyer/affordability", {
    token: buyerToken,
    body: { mode: "auto", grossIncome: 42000, monthlyDebts: 4500, deposit: 40000, interestRate: 11.75, termMonths: 72 }
  });
  assert(afford.envelope.maxPrice > 0, `computed envelope max price = ${afford.envelope.maxPrice}`);

  console.log("5. Buyer requests matches");
  const matches = await api("GET", "/api/buyer/matches?mode=auto", { token: buyerToken });
  assert(Array.isArray(matches.matches) && matches.matches.length > 0, `got ${matches.matches.length} scored matches`);
  assert(matches.matches[0].score >= matches.matches[matches.matches.length - 1].score, "matches sorted by score desc");
  const topMatch = matches.matches[0];

  console.log("6. Buyer requests an offer on the top match");
  const leadRes = await api("POST", "/api/buyer/leads", { token: buyerToken, body: { listingId: topMatch.id } });
  assert(leadRes.lead.status === "new", "lead created with status 'new'");
  const leadId = leadRes.lead.id;

  console.log("7. Provider sees the lead in their dashboard, with affordability snapshot attached");
  const providerLeads = await api("GET", "/api/provider/leads", { token: providerToken });
  const providerLead = providerLeads.leads.find((l) => l.id === leadId);
  assert(!!providerLead, "provider can see the new lead");
  assert(providerLead.affordabilitySnapshot.maxPrice > 0, "lead carries the buyer's affordability snapshot");
  assert(typeof providerLead.buyerName === "string" && providerLead.buyerName.length > 0, "lead carries buyer identity");

  console.log("8. Provider advances lead status to 'qualified'");
  const statusRes = await api("PATCH", `/api/provider/leads/${leadId}/status`, {
    token: providerToken,
    body: { status: "qualified" }
  });
  assert(statusRes.lead.status === "qualified", "status updated to qualified");

  console.log("9. Provider submits an offer");
  const offerRes = await api("POST", `/api/provider/leads/${leadId}/offer`, {
    token: providerToken,
    body: { price: topMatch.price, monthlyPayment: topMatch.estimatedPayment, notes: "Includes 2yr service plan" }
  });
  assert(offerRes.offer.buyerResponse === "pending", "offer created, awaiting buyer response");
  const offerId = offerRes.offer.id;

  console.log("10. Buyer sees the offer in 'my leads'");
  const myLeads = await api("GET", "/api/buyer/leads", { token: buyerToken });
  const myLead = myLeads.leads.find((l) => l.id === leadId);
  assert(myLead.status === "offer_sent", "buyer sees status offer_sent");
  assert(myLead.offer && myLead.offer.id === offerId, "buyer sees the actual offer terms");

  console.log("11. Buyer accepts the offer");
  const acceptRes = await api("POST", `/api/buyer/offers/${offerId}/respond`, {
    token: buyerToken,
    body: { response: "accepted" }
  });
  assert(acceptRes.status === "won", "lead status is now 'won'");

  console.log("12. Admin sees the won deal in the platform overview");
  const overview = await api("GET", "/api/admin/overview", { token: adminToken });
  const wonCount = overview.leadsByStatus.find((s) => s.status === "won");
  assert(wonCount && wonCount.count >= 1, `admin overview shows ${wonCount ? wonCount.count : 0} won lead(s)`);
  assert(overview.wonDeals.count >= 1, `admin overview shows ${overview.wonDeals.count} accepted offer(s) worth R${overview.wonDeals.totalValue}`);

  console.log("13. Cross-role security: buyer cannot hit provider routes");
  try {
    await api("GET", "/api/provider/leads", { token: buyerToken });
    throw new Error("expected 403, request succeeded instead");
  } catch (err) {
    assert(err.message.includes("403"), "buyer correctly forbidden from provider routes");
  }

  console.log("\nALL INTEGRATION CHECKS PASSED");
}

main().catch((err) => {
  console.error("\nINTEGRATION TEST FAILED:", err.message);
  process.exit(1);
});
