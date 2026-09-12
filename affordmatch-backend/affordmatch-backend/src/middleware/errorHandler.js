"use strict";

/** Wraps an async route handler so rejected promises reach the error handler. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Express error-handling middleware — must be registered last, with 4 args. */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);

  if (err.name === "ZodError") {
    return res.status(400).json({ error: "Validation failed", details: err.issues });
  }
  if (err.code === "23505") { // Postgres unique_violation
    return res.status(409).json({ error: "That record already exists" });
  }
  if (err.code === "23503") { // Postgres foreign_key_violation
    return res.status(400).json({ error: "Referenced record does not exist" });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  return res.status(500).json({ error: "Internal server error" });
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { asyncHandler, errorHandler, ApiError };
