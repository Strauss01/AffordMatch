"use strict";
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const ctrl = require("../controllers/adminController");

router.use(requireAuth, requireRole("admin"));

router.get("/overview", asyncHandler(ctrl.getOverview));
router.get("/providers", asyncHandler(ctrl.listProviders));
router.get("/buyers", asyncHandler(ctrl.listBuyers));
router.get("/leads", asyncHandler(ctrl.listAllLeads));
router.post("/users/:id/deactivate", asyncHandler(ctrl.deactivateUser));

module.exports = router;
