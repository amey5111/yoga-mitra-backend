const express = require("express");
const {
  generateRoutineController,
  updateRoutineController,
} = require("../controllers/routineController");
const User = require("../models/User");

const router = express.Router();

router.post("/generate", generateRoutineController);

router.put("/user/:userId", updateRoutineController);

// ── Return routine AND saved recommendations together ────────────────────────
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      routine: user.routine ?? null,
      savedPoseRecommendations: user.savedPoseRecommendations ?? [],
      savedBreathingRecommendations: user.savedBreathingRecommendations ?? [],
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch routine" });
  }
});

module.exports = router;
