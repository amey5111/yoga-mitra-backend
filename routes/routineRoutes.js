const express = require("express");
const {
  generateRoutineController,
} = require("../controllers/routineController");
const User = require("../models/User");

const router = express.Router();

router.post("/generate", generateRoutineController);

router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);

    if (!user || !user.routine) {
      return res.json({ routine: null });
    }

    return res.json(user.routine);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch routine" });
  }
});

module.exports = router;
