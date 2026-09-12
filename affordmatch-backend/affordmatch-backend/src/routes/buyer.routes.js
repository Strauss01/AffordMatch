"use strict";
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const affordCtrl = require("../controllers/affordabilityController");
const listingsCtrl = require("../controllers/listingsController");
const leadsCtrl = require("../controllers/leadsController");

router.use(requireAuth, requireRole("buyer"));

router.post("/affordability", asyncHandler(affordCtrl.submitAffordability));
router.get("/affordability", asyncHandler(affordCtrl.getCurrentAffordability));

router.get("/matches", asyncHandler(listingsCtrl.getMatches));

router.post("/leads", asyncHandler(leadsCtrl.createLead));
router.get("/leads", asyncHandler(leadsCtrl.listMyLeads));
router.post("/offers/:id/respond", asyncHandler(leadsCtrl.respondToOffer));

module.exports = router;
