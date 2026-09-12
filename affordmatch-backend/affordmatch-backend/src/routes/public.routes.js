"use strict";
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const ctrl = require("../controllers/listingsController");

router.get("/listings", asyncHandler(ctrl.listPublicListings));

module.exports = router;
