const express = require("express");
const { callAIRecommendations } = require("../utils/aiClient");

const router = express.Router();

router.post("/recommend", async (req, res) => {
  try {
    console.log("====== RECOMMENDATION API HIT ======");
    console.log("Incoming Body:", req.body);

    const { userProfile = {}, healthInfo = {}, goals = {} } = req.body;

    const recommendations = await callAIRecommendations(
      userProfile,
      healthInfo,
      goals,
    );

    console.log("Final Recommendations:", recommendations);

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
