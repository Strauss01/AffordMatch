"use strict";
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const listingsCtrl = require("../controllers/listingsController");
const leadsCtrl = require("../controllers/leadsController");

router.use(requireAuth, requireRole("provider"));

router.post("/listings", asyncHandler(listingsCtrl.createListing));
router.get("/listings", asyncHandler(listingsCtrl.listOwnListings));
router.patch("/listings/:id", asyncHandler(listingsCtrl.updateListing));

router.get("/leads", asyncHandler(leadsCtrl.listProviderLeads));
router.patch("/leads/:id/status", asyncHandler(leadsCtrl.updateLeadStatus));
router.post("/leads/:id/offer", asyncHandler(leadsCtrl.createOffer));

module.exports = router;
