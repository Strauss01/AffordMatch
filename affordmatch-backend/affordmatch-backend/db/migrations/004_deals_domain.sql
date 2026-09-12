-- =========================================================================
-- Migration 004: provider / transaction domain
-- =========================================================================

CREATE TYPE deals.lead_status AS ENUM ('new', 'contacted', 'qualified', 'offer_sent', 'won', 'lost');
CREATE TYPE deals.offer_response AS ENUM ('pending', 'accepted', 'declined');
CREATE TYPE deals.subscription_plan AS ENUM ('starter', 'growth', 'pro');
CREATE TYPE deals.subscription_status AS ENUM ('active', 'past_due', 'cancelled');

-- -------------------------------------------------------------------------
-- deals.leads — created the moment a buyer requests an offer. Carries the
-- affordability snapshot and match score at time of request so a provider
-- always sees "why this lead is qualified", not just a name and number.
-- -------------------------------------------------------------------------
CREATE TABLE deals.leads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id       UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider_id    UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  listing_id     UUID NOT NULL REFERENCES catalog.listings(id) ON DELETE CASCADE,
  snapshot_id    UUID NOT NULL REFERENCES afford.snapshots(id),
  match_score    SMALLINT NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  status         deals.lead_status NOT NULL DEFAULT 'new',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, listing_id) -- one open request per buyer per listing
);

CREATE INDEX idx_leads_provider_status ON deals.leads(provider_id, status);
CREATE INDEX idx_leads_buyer ON deals.leads(buyer_id);

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON deals.leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------------------------
-- deals.offers — at most one active offer per lead. Buyer response is
-- tracked separately from lead.status so "offer sent but buyer hasn't
-- responded yet" is a distinguishable state from "buyer accepted".
-- -------------------------------------------------------------------------
CREATE TABLE deals.offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL UNIQUE REFERENCES deals.leads(id) ON DELETE CASCADE,
  price            NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  monthly_payment  NUMERIC(12,2) NOT NULL CHECK (monthly_payment >= 0),
  notes            TEXT,
  buyer_response   deals.offer_response NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at     TIMESTAMPTZ
);

-- -------------------------------------------------------------------------
-- deals.status_history — append-only audit trail of every lead status
-- transition, who made it, and when. Never updated, only inserted into.
-- -------------------------------------------------------------------------
CREATE TABLE deals.status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES deals.leads(id) ON DELETE CASCADE,
  from_status   deals.lead_status,
  to_status     deals.lead_status NOT NULL,
  changed_by    UUID REFERENCES identity.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_history_lead ON deals.status_history(lead_id);

-- -------------------------------------------------------------------------
-- deals.subscriptions — the revenue engine. One active subscription per
-- provider; history is kept by inserting a new row rather than updating,
-- so past billing periods remain queryable.
-- -------------------------------------------------------------------------
CREATE TABLE deals.subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id         UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  plan                deals.subscription_plan NOT NULL,
  status              deals.subscription_status NOT NULL DEFAULT 'active',
  current_period_end  DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_provider ON deals.subscriptions(provider_id);
