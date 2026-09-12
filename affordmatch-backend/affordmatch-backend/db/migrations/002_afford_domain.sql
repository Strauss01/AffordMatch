-- =========================================================================
-- Migration 002: affordability domain
--
-- Affordability inputs are versioned rather than overwritten in place: a
-- buyer's income changes over time, and a lead created three months ago
-- should keep pointing at the numbers that were true then, not today's.
-- =========================================================================

CREATE TYPE afford.buyer_mode AS ENUM ('auto', 'property');

-- -------------------------------------------------------------------------
-- afford.profiles — one row per time the buyer (re)submits their numbers.
-- The most recent row per (buyer_id, mode) is "current".
-- -------------------------------------------------------------------------
CREATE TABLE afford.profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  mode             afford.buyer_mode NOT NULL,
  gross_income     NUMERIC(12,2) NOT NULL CHECK (gross_income >= 0),
  monthly_debts    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_debts >= 0),
  deposit          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  interest_rate    NUMERIC(5,2)  NOT NULL CHECK (interest_rate > 0), -- annual %, e.g. 11.75
  term_months      INTEGER       NOT NULL CHECK (term_months > 0),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_afford_profiles_buyer_mode ON afford.profiles(buyer_id, mode, created_at DESC);

-- -------------------------------------------------------------------------
-- afford.snapshots — the *computed* envelope for a given profile, at the
-- moment it was computed. A snapshot is immutable once created; if rates
-- or the scoring formula change, recompute a new snapshot rather than
-- editing an old one. Leads and match_events reference a snapshot_id so
-- "what did we tell this buyer they could afford" is always answerable.
-- -------------------------------------------------------------------------
CREATE TABLE afford.snapshots (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id               UUID NOT NULL REFERENCES afford.profiles(id) ON DELETE CASCADE,
  max_monthly_payment      NUMERIC(12,2) NOT NULL,
  min_price                NUMERIC(14,2) NOT NULL,
  max_price                NUMERIC(14,2) NOT NULL,
  over_committed           BOOLEAN NOT NULL DEFAULT FALSE,
  engine_version           TEXT NOT NULL DEFAULT 'v1', -- bump when the scoring formula changes
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_afford_snapshots_profile ON afford.snapshots(profile_id);

-- convenience view: current affordability snapshot per buyer + mode
CREATE VIEW afford.current_snapshot AS
  SELECT DISTINCT ON (p.buyer_id, p.mode)
    p.buyer_id, p.mode, p.id AS profile_id, s.id AS snapshot_id,
    p.gross_income, p.monthly_debts, p.deposit, p.interest_rate, p.term_months,
    s.max_monthly_payment, s.min_price, s.max_price, s.over_committed, s.computed_at
  FROM afford.profiles p
  JOIN afford.snapshots s ON s.profile_id = p.id
  ORDER BY p.buyer_id, p.mode, p.created_at DESC, s.computed_at DESC;
