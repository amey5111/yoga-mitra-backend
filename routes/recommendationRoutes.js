const express = require("express");
const { callAIRecommendations } = require("../utils/aiClient");
const User = require("../models/User");
const YogaPose = require("../models/YogaPose");
const BreathingTechnique = require("../models/BreathingTechnique");

const router = express.Router();

router.post("/recommend", async (req, res) => {
  try {
    console.log("====== RECOMMENDATION API HIT ======");
    console.log("Incoming Body:", req.body);

    const { userProfile = {}, healthInfo = {}, goals = {}, userId } = req.body;

    const recommendations = await callAIRecommendations(
      userProfile,
      healthInfo,
      goals,
    );

    console.log("Final Recommendations:", recommendations);

    // ── Persist full recommendation details to user document ─────────────────
    if (userId && Array.isArray(recommendations)) {
      const poseRecs = recommendations.filter((r) => r.type == null);
      const breathingRecs = recommendations.filter(
        (r) => r.type === "breathing",
      );

      const poseIds = poseRecs.map((r) => r.id);
      const breathingIds = breathingRecs.map((r) => r.id);

      const [poses, breathings] = await Promise.all([
        YogaPose.find({ id: { $in: poseIds } }).lean(),
        BreathingTechnique.find({ id: { $in: breathingIds } }).lean(),
      ]);

      // Merge AI reason into each pose document
      const savedPoses = poses.map((pose) => {
        const rec = poseRecs.find((r) => r.id === pose.id);
        return {
          id: pose.id,
          type: null,
          reason: rec?.reason ?? {},
          name: pose.name,
          image_url: pose.image_url,
          duration_seconds: pose.duration_seconds,
          repetitions: pose.repetitions,
          primary_benefits: pose.primary_benefits,
          difficulty_level: pose.difficulty_level,
          video: pose.video,
        };
      });

      // Merge AI reason into each breathing document
      const savedBreathings = breathings.map((b) => {
        const rec = breathingRecs.find((r) => r.id === b.id);
        return {
          id: b.id,
          type: "breathing",
          reason: rec?.reason ?? {},
          name: b.name,
          image_url: b.image_url,
          duration_seconds: b.duration_seconds,
          repetitions: b.repetitions,
          primary_benefits: b.primary_benefits,
          difficulty_level: b.difficulty_level,
          video: b.video,
        };
      });

      await User.findByIdAndUpdate(userId, {
        savedPoseRecommendations: savedPoses,
        savedBreathingRecommendations: savedBreathings,
      });
    }

    return res.json({
      recommendations: recommendations || [],
    });
  } catch (err) {
    console.error("RECOMMEND ERROR:", err);
    return res.status(500).json({
      recommendations: [],
    });
  }
});

module.exports = router;
