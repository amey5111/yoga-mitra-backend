const express = require("express");
const User = require("../models/User");

const router = express.Router();

/* Full user snapshot: profile + health + report + saved recommendations */
router.get("/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("-password")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch user" });
  }
});

/* Save / update the persisted health profile */
router.put("/:userId/health", async (req, res) => {
  try {
    const {
      height,
      weight,
      activityLevel,
      medicalConditions,
      focusBodyParts,
      goalTags,
      routineDuration,
    } = req.body || {};

    const healthProfile = {
      height,
      weight,
      activityLevel,
      medicalConditions: Array.isArray(medicalConditions)
        ? medicalConditions
        : [],
      focusBodyParts: Array.isArray(focusBodyParts) ? focusBodyParts : [],
      goalTags: Array.isArray(goalTags) ? goalTags : [],
      routineDuration,
    };

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { healthProfile },
      { new: true },
    )
      .select("healthProfile")
      .lean();

    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(user.healthProfile);
  } catch (err) {
    return res.status(500).json({ message: "Failed to save health profile" });
  }
});

/* Save / update the AI medical report */
router.put("/:userId/report", async (req, res) => {
  try {
    const {
      knownConditions,
      otherConditions,
      summary,
      cautions,
      fileName,
      uploadedAt,
    } = req.body || {};

    const medicalReport = {
      knownConditions: Array.isArray(knownConditions) ? knownConditions : [],
      otherConditions: Array.isArray(otherConditions) ? otherConditions : [],
      summary: summary || "",
      cautions: cautions || "",
      fileName: fileName || "",
      uploadedAt: uploadedAt ? new Date(uploadedAt) : new Date(),
    };

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { medicalReport },
      { new: true },
    )
      .select("medicalReport")
      .lean();

    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json(user.medicalReport);
  } catch (err) {
    return res.status(500).json({ message: "Failed to save report" });
  }
});

/* Delete the stored medical report */
router.delete("/:userId/report", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $unset: { medicalReport: "" } },
      { new: true },
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ message: "Report deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete report" });
  }
});

module.exports = router;
