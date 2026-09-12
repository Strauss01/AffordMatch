"use strict";
const { z } = require("zod");

const registerBuyerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().optional()
});

const registerProviderSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  companyName: z.string().min(1),
  category: z.enum(["auto", "property"]),
  contactName: z.string().optional(),
  contactPhone: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const affordabilitySchema = z.object({
  mode: z.enum(["auto", "property"]),
  grossIncome: z.number().nonnegative(),
  monthlyDebts: z.number().nonnegative(),
  deposit: z.number().nonnegative(),
  interestRate: z.number().positive(),
  termMonths: z.number().int().positive()
});

const createListingSchema = z.object({
  category: z.enum(["auto", "property"]),
  title: z.string().min(1),
  location: z.string().optional(),
  price: z.number().nonnegative(),
  metadata: z.record(z.any()).optional()
});

const updateListingSchema = createListingSchema.partial().extend({
  status: z.enum(["active", "inactive", "sold"]).optional()
});

const createLeadSchema = z.object({
  listingId: z.string().uuid()
});

const updateLeadStatusSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "offer_sent", "won", "lost"])
});

const createOfferSchema = z.object({
  price: z.number().nonnegative(),
  monthlyPayment: z.number().nonnegative(),
  notes: z.string().optional()
});

const offerResponseSchema = z.object({
  response: z.enum(["accepted", "declined"])
});

module.exports = {
  registerBuyerSchema,
  registerProviderSchema,
  loginSchema,
  affordabilitySchema,
  createListingSchema,
  updateListingSchema,
  createLeadSchema,
  updateLeadStatusSchema,
  createOfferSchema,
  offerResponseSchema
};
