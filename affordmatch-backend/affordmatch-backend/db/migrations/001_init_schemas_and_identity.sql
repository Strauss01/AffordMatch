-- =========================================================================
-- Migration 001: schema namespaces + identity/consent domain
--
-- AffordMatch keeps four domains in four separate Postgres schemas so that
-- identity data, affordability data, matching/catalog data, and
-- provider/transaction data can be secured, backed up, and reasoned about
-- independently (e.g. different retention rules for consent records vs.
-- inventory, different read/write load patterns for match_events vs. deals).
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";   -- case-insensitive email column

CREATE SCHEMA IF NOT EXISTS identity;   -- users, provider/buyer profiles, consent
CREATE SCHEMA IF NOT EXISTS afford;     -- affordability inputs + computed envelopes
CREATE SCHEMA IF NOT EXISTS catalog;    -- listings + match scoring events
CREATE SCHEMA IF NOT EXISTS deals;      -- leads, offers, status history, subscriptions

-- generic "touch updated_at" trigger function, reused across every table
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- identity.users — one row per login, regardless of role
-- -------------------------------------------------------------------------
CREATE TYPE identity.user_role AS ENUM ('buyer', 'provider', 'admin');

CREATE TABLE identity.users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT NOT NULL UNIQUE,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  role           identity.user_role NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------------------------
-- identity.buyer_profiles — 1:1 with a buyer user
-- -------------------------------------------------------------------------
CREATE TABLE identity.buyer_profiles (
  user_id     UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- identity.provider_profiles — 1:1 with a provider user (dealership/agency)
-- -------------------------------------------------------------------------
CREATE TYPE identity.provider_category AS ENUM ('auto', 'property');

CREATE TABLE identity.provider_profiles (
  user_id          UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  company_name     TEXT NOT NULL,
  category         identity.provider_category NOT NULL,
  contact_name     TEXT,
  contact_phone    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- identity.consents — append-only audit trail of what a user agreed to,
-- and when. Never update or delete a row here; revoke by inserting a new
-- row with revoked_at set / a fresh consent_type. Modelled loosely on
-- POPIA consent-record requirements and NCA affordability-check disclosure.
-- -------------------------------------------------------------------------
CREATE TABLE identity.consents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  consent_type   TEXT NOT NULL,          -- e.g. 'affordability_check', 'marketing', 'data_sharing_with_providers'
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  ip_address     INET
);

CREATE INDEX idx_consents_user ON identity.consents(user_id);
