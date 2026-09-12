"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  monthlyPayment,
  computeAffordability,
  scoreListing,
  rankListings
} = require("../src/services/matchingEngine");

test("monthlyPayment matches a known amortisation result", () => {
  // R300,000 principal, 11.75% annual, 72 months
  const payment = monthlyPayment(300000, 11.75, 72);
  assert.ok(payment > 5600 && payment < 5900, `unexpected payment: ${payment}`);
});

test("monthlyPayment handles zero interest rate", () => {
  assert.equal(monthlyPayment(120000, 0, 12), 10000);
});

test("monthlyPayment handles zero principal", () => {
  assert.equal(monthlyPayment(0, 10, 60), 0);
});

test("computeAffordability returns a sane envelope for a typical buyer", () => {
  const envelope = computeAffordability({
    mode: "auto",
    grossIncome: 42000,
    monthlyDebts: 4500,
    deposit: 40000,
    interestRate: 11.75,
    termMonths: 72
  });
  assert.ok(envelope.maxMonthlyPayment > 0);
  assert.ok(envelope.maxPrice > envelope.minPrice);
  assert.equal(envelope.overCommitted, false);
});

test("computeAffordability flags over-committed buyers with zero envelope", () => {
  const envelope = computeAffordability({
    mode: "auto",
    grossIncome: 15000,
    monthlyDebts: 14000, // total debt ceiling (40% of 15000 = 6000) already exceeded
    deposit: 0,
    interestRate: 11.75,
    termMonths: 72
  });
  assert.equal(envelope.overCommitted, true);
  assert.equal(envelope.maxMonthlyPayment, 0);
  assert.equal(envelope.maxPrice, 0);
});

test("category cap binds even when total-debt cap would allow more", () => {
  // income 100000, no existing debt -> total cap = 40000, category cap (auto, 20%) = 20000
  const envelope = computeAffordability({
    mode: "auto",
    grossIncome: 100000,
    monthlyDebts: 0,
    deposit: 0,
    interestRate: 11.75,
    termMonths: 72
  });
  assert.equal(envelope.maxMonthlyPayment, 20000);
});

test("scoreListing gives a high score to a listing near the sweet spot", () => {
  const loanTerms = { deposit: 40000, interestRate: 11.75, termMonths: 72 };
  const envelope = { maxMonthlyPayment: 10000 };
  // work backwards: find the principal whose payment is ~82% of maxMonthlyPayment
  const targetPayment = envelope.maxMonthlyPayment * 0.82;
  const r = 11.75 / 100 / 12;
  const f = Math.pow(1 + r, 72);
  const principal = (targetPayment * (f - 1)) / (r * f);
  const price = principal + loanTerms.deposit;

  const { score } = scoreListing(price, loanTerms, envelope);
  assert.ok(score >= 90, `expected a near-perfect score at the sweet spot, got ${score}`);
});

test("scoreListing penalises over-budget listings more than under-budget ones", () => {
  const envelope = { maxMonthlyPayment: 5000 };
  const loanTerms = { deposit: 0, interestRate: 11.75, termMonths: 72 };
  const under = scoreListing(50000, loanTerms, envelope);   // tiny payment, well under budget
  const over = scoreListing(600000, loanTerms, envelope);   // payment well over budget
  assert.ok(over.score < under.score);
});

test("scoreListing returns 0 for an over-committed buyer (zero envelope)", () => {
  const { score } = scoreListing(100000, { deposit: 0, interestRate: 11.75, termMonths: 72 }, { maxMonthlyPayment: 0 });
  assert.equal(score, 0);
});

test("rankListings sorts by score descending", () => {
  const envelope = { maxMonthlyPayment: 8000 };
  const loanTerms = { deposit: 20000, interestRate: 11.75, termMonths: 72 };
  const listings = [
    { id: "cheap", price: 60000 },
    { id: "fit", price: 350000 },
    { id: "expensive", price: 900000 }
  ];
  const ranked = rankListings(listings, loanTerms, envelope);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[1].score >= ranked[2].score);
});
