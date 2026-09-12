"use strict";

/**
 * AffordMatch matching engine (v1).
 *
 * Pure functions only — no DB, no HTTP — so this module can be unit tested
 * in isolation and reused by any caller (API route, background job, a
 * future mobile client that wants to estimate client-side before syncing).
 *
 * Formula notes:
 *  - Standard amortising-loan payment formula.
 *  - "Affordability" caps the new repayment at whichever is tighter of:
 *      (a) a category-specific share of gross income (dtiCap), or
 *      (b) what's left of a total-debt-service ceiling after existing debts.
 *    This loosely mirrors a National Credit Act–style affordability check:
 *    category cap protects against over-concentration in one repayment,
 *    total cap protects against overall over-indebtedness.
 *  - Match score rewards listings that use the budget well (target ~82% of
 *    the max allowed repayment) without exceeding it, and penalises
 *    over-budget listings more steeply than under-using the budget.
 */

const MODE_DEFAULTS = Object.freeze({
  auto: { rate: 11.75, term: 72, dtiCap: 0.20, label: "vehicle" },
  property: { rate: 11.25, term: 240, dtiCap: 0.30, label: "home" }
});

const TOTAL_DEBT_CEILING = 0.40; // share of gross income all debt (existing + new) may consume
const ENVELOPE_FLOOR_RATIO = 0.65; // min price as a fraction of max price, to give a browsable range
const SCORE_SWEET_SPOT = 0.82; // fraction of max monthly payment considered an ideal fit
const SCORE_UNDER_BUDGET_PENALTY = 130; // steepness of penalty for using too little of the budget
const SCORE_OVER_BUDGET_PENALTY = 220; // steepness of penalty for exceeding the budget (steeper on purpose)

function monthlyPayment(principal, annualRatePct, termMonths) {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / termMonths;
  const f = Math.pow(1 + r, termMonths);
  return (principal * r * f) / (f - 1);
}

function maxPrincipalFromPayment(payment, annualRatePct, termMonths) {
  if (payment <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return payment * termMonths;
  const f = Math.pow(1 + r, termMonths);
  return (payment * (f - 1)) / (r * f);
}

/**
 * Compute the affordability envelope for a set of inputs.
 * @param {{mode:'auto'|'property', grossIncome:number, monthlyDebts:number,
 *          deposit:number, interestRate:number, termMonths:number}} input
 */
function computeAffordability(input) {
  const { mode, grossIncome, monthlyDebts, deposit, interestRate, termMonths } = input;
  const def = MODE_DEFAULTS[mode];
  if (!def) throw new Error(`Unknown mode: ${mode}`);

  const capByCategory = grossIncome * def.dtiCap;
  const capByTotal = grossIncome * TOTAL_DEBT_CEILING - monthlyDebts;
  const maxMonthlyPayment = Math.max(0, Math.min(capByCategory, capByTotal));

  const maxPrincipal = maxPrincipalFromPayment(maxMonthlyPayment, interestRate, termMonths);
  const maxPrice = Math.max(0, maxPrincipal + Number(deposit || 0));
  const minPrice = Math.max(0, maxPrice * ENVELOPE_FLOOR_RATIO);

  return {
    maxMonthlyPayment: round2(maxMonthlyPayment),
    minPrice: round2(minPrice),
    maxPrice: round2(maxPrice),
    overCommitted: capByTotal <= 0
  };
}

/**
 * Score a single listing against a computed affordability envelope.
 * @param {number} listingPrice
 * @param {{deposit:number, interestRate:number, termMonths:number}} loanTerms
 * @param {{maxMonthlyPayment:number}} envelope
 */
function scoreListing(listingPrice, loanTerms, envelope) {
  const principal = Math.max(0, listingPrice - Number(loanTerms.deposit || 0));
  const payment = monthlyPayment(principal, loanTerms.interestRate, loanTerms.termMonths);

  if (envelope.maxMonthlyPayment <= 0) {
    return { score: 0, estimatedPayment: round2(payment) };
  }

  const ratio = payment / envelope.maxMonthlyPayment;
  let score;
  if (ratio <= 1) {
    score = 100 - Math.abs(ratio - SCORE_SWEET_SPOT) * SCORE_UNDER_BUDGET_PENALTY;
  } else {
    score = 100 - (ratio - 1) * SCORE_OVER_BUDGET_PENALTY;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, estimatedPayment: round2(payment) };
}

/**
 * Score and rank a batch of listings against one affordability envelope.
 * @param {Array<{id:string, price:number}>} listings
 */
function rankListings(listings, loanTerms, envelope) {
  return listings
    .map((listing) => {
      const { score, estimatedPayment } = scoreListing(listing.price, loanTerms, envelope);
      return { ...listing, score, estimatedPayment };
    })
    .sort((a, b) => b.score - a.score);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  MODE_DEFAULTS,
  monthlyPayment,
  maxPrincipalFromPayment,
  computeAffordability,
  scoreListing,
  rankListings
};
