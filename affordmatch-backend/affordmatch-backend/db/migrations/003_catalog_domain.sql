-- =========================================================================
-- Migration 003: catalog / matching domain
-- =========================================================================

CREATE TYPE catalog.listing_status AS ENUM ('active', 'inactive', 'sold');

-- -------------------------------------------------------------------------
-- catalog.listings — provider-managed inventory, automotive or property.
-- Category-specific detail lives in `metadata jsonb` rather than as
-- separate tables per vertical, so a new vertical (e.g. capital equipment)
-- is a new category value + metadata shape, not a schema migration.
-- -------------------------------------------------------------------------
CREATE TABLE catalog.listings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  category      identity.provider_category NOT NULL,
  title         TEXT NOT NULL,
  location      TEXT,
  price         NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  status        catalog.listing_status NOT NULL DEFAULT 'active',
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"year":2022,"mileage_km":31000} or {"bedrooms":3,"erf_size_m2":450}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listings_provider ON catalog.listings(provider_id);
CREATE INDEX idx_listings_category_status ON catalog.listings(category, status);
CREATE INDEX idx_listings_price ON catalog.listings(price);

CREATE TRIGGER trg_listings_updated_at BEFORE UPDATE ON catalog.listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------------------------
-- catalog.match_events — every time the matching engine scores a listing
-- against a buyer's current affordability snapshot, we can log it here.
-- Powers "why was I shown this" audits and future model tuning; not
-- required on the hot path (the API returns scores without needing to
-- read this table back), so writes to it can be fire-and-forget.
-- -------------------------------------------------------------------------
CREATE TABLE catalog.match_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id       UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  listing_id     UUID NOT NULL REFERENCES catalog.listings(id) ON DELETE CASCADE,
  snapshot_id    UUID NOT NULL REFERENCES afford.snapshots(id) ON DELETE CASCADE,
  score          SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  estimated_payment NUMERIC(12,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_events_buyer ON catalog.match_events(buyer_id, created_at DESC);
CREATE INDEX idx_match_events_listing ON catalog.match_events(listing_id);
