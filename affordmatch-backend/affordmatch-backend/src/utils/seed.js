"use strict";
require("dotenv").config();
const { Client } = require("pg");
const { hashPassword } = require("./password");
const { pgClientOptions } = require("./dbClientOptions");

const AUTO_LISTINGS = [
  { title: "Toyota Corolla Cross 1.8 XS", location: "Johannesburg", price: 389900, provider: "Johannesburg Toyota" },
  { title: "Volkswagen Polo Vivo 1.4 Comfortline", location: "Pretoria", price: 239500, provider: "Pretoria VW" },
  { title: "Suzuki Swift 1.2 GL", location: "Randburg", price: 259900, provider: "Randburg Suzuki" },
  { title: "Ford Ranger 2.2 XL Double Cab", location: "Midrand", price: 459000, provider: "Midrand Ford" },
  { title: "Hyundai Venue 1.0T Fluid", location: "Sandton", price: 329900, provider: "Sandton Hyundai" },
  { title: "BMW 320i Sport Line", location: "Centurion", price: 449900, provider: "Centurion BMW" },
  { title: "Renault Kwid 1.0 Dynamique", location: "Roodepoort", price: 189900, provider: "Roodepoort Renault" },
  { title: "Mercedes-Benz C180", location: "Sandton", price: 549900, provider: "Sandton Mercedes" }
];

const PROPERTY_LISTINGS = [
  { title: "2 Bed Apartment, Sandton", location: "Sandton", price: 1650000, provider: "Sandton Realty Group" },
  { title: "3 Bed House, Fourways", location: "Fourways", price: 2450000, provider: "Fourways Estates" },
  { title: "2 Bed Townhouse, Randburg", location: "Randburg", price: 1290000, provider: "Randburg Property Co." },
  { title: "1 Bed Apartment, Rosebank", location: "Rosebank", price: 980000, provider: "Rosebank Realty" },
  { title: "4 Bed House, Midrand", location: "Midrand", price: 3150000, provider: "Midrand Estates" },
  { title: "3 Bed Cluster, Centurion", location: "Centurion", price: 1890000, provider: "Centurion Property Co." },
  { title: "Studio Apartment, Melville", location: "Melville", price: 720000, provider: "Melville Realty" },
  { title: "3 Bed House, Kempton Park", location: "Kempton Park", price: 1560000, provider: "Kempton Property Co." }
];

async function main() {
  const client = new Client(pgClientOptions());
  await client.connect();
  const passwordHash = await hashPassword("Password123!");

  console.log("Seeding admin user...");
  await client.query(
    `INSERT INTO identity.users (email, password_hash, role) VALUES ('admin@affordmatch.dev', $1, 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [passwordHash]
  );

  console.log("Seeding demo buyer...");
  const buyerRes = await client.query(
    `INSERT INTO identity.users (email, password_hash, role) VALUES ('buyer@affordmatch.dev', $1, 'buyer')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [passwordHash]
  );
  const buyerId = buyerRes.rows[0].id;
  await client.query(
    `INSERT INTO identity.buyer_profiles (user_id, full_name) VALUES ($1, 'Thabo Nkosi')
     ON CONFLICT (user_id) DO NOTHING`,
    [buyerId]
  );

  const providerNames = new Set([...AUTO_LISTINGS, ...PROPERTY_LISTINGS].map((l) => l.provider));
  const providerIds = {};

  for (const name of providerNames) {
    const category = AUTO_LISTINGS.some((l) => l.provider === name) ? "auto" : "property";
    const email = `${slug(name)}@affordmatch.dev`;
    const res = await client.query(
      `INSERT INTO identity.users (email, password_hash, role) VALUES ($1, $2, 'provider')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [email, passwordHash]
    );
    const providerId = res.rows[0].id;
    providerIds[name] = providerId;

    await client.query(
      `INSERT INTO identity.provider_profiles (user_id, company_name, category)
       VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [providerId, name, category]
    );
    const subExists = await client.query(`SELECT id FROM deals.subscriptions WHERE provider_id = $1`, [providerId]);
    if (!subExists.rows[0]) {
      await client.query(
        `INSERT INTO deals.subscriptions (provider_id, plan, status, current_period_end)
         VALUES ($1, 'growth', 'active', now() + interval '30 days')`,
        [providerId]
      );
    }
  }

  console.log("Seeding listings...");
  for (const item of AUTO_LISTINGS) {
    await insertListing(client, providerIds[item.provider], "auto", item);
  }
  for (const item of PROPERTY_LISTINGS) {
    await insertListing(client, providerIds[item.provider], "property", item);
  }

  console.log("Done.");
  console.log("---");
  console.log("Demo logins (password for all: Password123!):");
  console.log("  admin@affordmatch.dev   (admin)");
  console.log("  buyer@affordmatch.dev   (buyer)");
  console.log(`  ${slug(AUTO_LISTINGS[0].provider)}@affordmatch.dev   (provider, auto)`);
  console.log(`  ${slug(PROPERTY_LISTINGS[0].provider)}@affordmatch.dev   (provider, property)`);

  await client.end();
}

async function insertListing(client, providerId, category, item) {
  const exists = await client.query(
    `SELECT id FROM catalog.listings WHERE provider_id = $1 AND title = $2`,
    [providerId, item.title]
  );
  if (exists.rows[0]) return;
  await client.query(
    `INSERT INTO catalog.listings (provider_id, category, title, location, price, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [providerId, category, item.title, item.location, item.price]
  );
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
