const { callAIRecommendations } = require("../utils/aiClient");

exports.getRecommendations = async (req, res) => {
  try {
    console.log("====== RECOMMENDATION API HIT ======");
    console.log("Incoming Body:", req.body);

    const { userProfile, healthInfo, goals } = req.body;

    const result = await callAIRecommendations(userProfile, healthInfo, goals);

    console.log("Controller Result:", result);

    return res.json(result);
  } catch (err) {
    console.error("Recommendation Error:", err);
    return res.status(500).json({
      message: "Failed to generate recommendations",
    });
  }
};
