const {
  generateRoutine,
  arrangeRoutine,
} = require("../services/routineGenerator");
const User = require("../models/User");

exports.generateRoutineController = async (req, res) => {
  try {
    const { poseIds, breathingIds, duration, userId } = req.body;
    const routine = await generateRoutine(poseIds, breathingIds, duration);
    if (userId) {
      await User.findByIdAndUpdate(userId, { routine });
    }
    res.json(routine);
  } catch (err) {
    console.error("Routine Error:", err);
    res.status(500).json({ message: "Routine generation failed" });
  }
};

exports.updateRoutineController = async (req, res) => {
  try {
    const { poseIds, breathingIds, userId } = req.body;
    const routine = await arrangeRoutine(poseIds || [], breathingIds || []);
    if (userId) {
      await User.findByIdAndUpdate(userId, { routine });
    }
    res.json(routine);
  } catch (err) {
    console.error("Update Routine Error:", err);
    res.status(500).json({ message: "Routine update failed" });
  }
};
