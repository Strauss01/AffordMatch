"use strict";
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { requireAuth } = require("../middleware/auth");
const ctrl = require("../controllers/authController");

router.post("/register/buyer", asyncHandler(ctrl.registerBuyer));
router.post("/register/provider", asyncHandler(ctrl.registerProvider));
router.post("/login", asyncHandler(ctrl.login));
router.get("/me", requireAuth, asyncHandler(ctrl.me));

module.exports = router;
