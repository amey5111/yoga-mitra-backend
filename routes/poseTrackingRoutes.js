const express = require("express");

const router = express.Router();

const {
  saveSession,
  getUserSessions,
} = require("../controllers/poseTrackingController");

router.post("/session", saveSession);

router.get("/user/:userId", getUserSessions);

module.exports = router;
