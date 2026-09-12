"use strict";
const { query, withTransaction } = require("../config/db");
const { hashPassword, verifyPassword } = require("../utils/password");
const { signToken } = require("../utils/jwt");
const { ApiError } = require("../middleware/errorHandler");
const {
  registerBuyerSchema,
  registerProviderSchema,
  loginSchema
} = require("../validators/schemas");

async function registerBuyer(req, res) {
  const input = registerBuyerSchema.parse(req.body);
  const passwordHash = await hashPassword(input.password);

  const user = await withTransaction(async (client) => {
    const userRes = await client.query(
      `INSERT INTO identity.users (email, phone, password_hash, role)
       VALUES ($1, $2, $3, 'buyer') RETURNING id, email, role, created_at`,
      [input.email.toLowerCase(), input.phone || null, passwordHash]
    );
    const newUser = userRes.rows[0];
    await client.query(
      `INSERT INTO identity.buyer_profiles (user_id, full_name) VALUES ($1, $2)`,
      [newUser.id, input.fullName]
    );
    await client.query(
      `INSERT INTO identity.consents (user_id, consent_type, ip_address)
       VALUES ($1, 'affordability_check', $2)`,
      [newUser.id, req.ip]
    );
    return newUser;
  });

  const token = signToken({ sub: user.id, role: user.role });
  res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

async function registerProvider(req, res) {
  const input = registerProviderSchema.parse(req.body);
  const passwordHash = await hashPassword(input.password);

  const user = await withTransaction(async (client) => {
    const userRes = await client.query(
      `INSERT INTO identity.users (email, password_hash, role)
       VALUES ($1, $2, 'provider') RETURNING id, email, role, created_at`,
      [input.email.toLowerCase(), passwordHash]
    );
    const newUser = userRes.rows[0];
    await client.query(
      `INSERT INTO identity.provider_profiles (user_id, company_name, category, contact_name, contact_phone)
       VALUES ($1, $2, $3, $4, $5)`,
      [newUser.id, input.companyName, input.category, input.contactName || null, input.contactPhone || null]
    );
    await client.query(
      `INSERT INTO deals.subscriptions (provider_id, plan, status, current_period_end)
       VALUES ($1, 'starter', 'active', now() + interval '30 days')`,
      [newUser.id]
    );
    return newUser;
  });

  const token = signToken({ sub: user.id, role: user.role });
  res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

async function login(req, res) {
  const input = loginSchema.parse(req.body);
  const result = await query(
    `SELECT id, email, password_hash, role, is_active FROM identity.users WHERE email = $1`,
    [input.email.toLowerCase()]
  );
  const user = result.rows[0];
  if (!user || !user.is_active) throw new ApiError(401, "Invalid email or password");

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) throw new ApiError(401, "Invalid email or password");

  const token = signToken({ sub: user.id, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
}

async function me(req, res) {
  const result = await query(
    `SELECT id, email, role, created_at FROM identity.users WHERE id = $1`,
    [req.user.id]
  );
  if (!result.rows[0]) throw new ApiError(404, "User not found");
  res.json({ user: result.rows[0] });
}

module.exports = { registerBuyer, registerProvider, login, me };
