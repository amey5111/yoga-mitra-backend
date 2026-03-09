const { generateRoutine } = require("../services/routineGenerator");
const User = require("../models/User");

exports.generateRoutineController = async (req, res) => {
  try {
    const { poseIds, breathingIds, duration, userId } = req.body;

    const routine = await generateRoutine(poseIds, breathingIds, duration);

    // Save routine to user
    if (userId) {
      await User.findByIdAndUpdate(userId, {
        routine: routine,
      });
    }

    res.json(routine);
  } catch (err) {
    console.error("Routine Error:", err);
    res.status(500).json({ message: "Routine generation failed" });
  }
};
