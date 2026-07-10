const express = require("express");
const { chatCompletion, parseJsonReply } = require("../utils/mistralClient");

const router = express.Router();

const LANG_NAMES = { en: "English", mr: "Marathi", hn: "Hindi" };

function safeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

router.post("/recommend", async (req, res) => {
  try {
    const {
      userProfile = {},
      healthInfo = {},
      goals = {},
      reportSummary = "",
      reportConditions = [],
      language = "en",
    } = req.body || {};

    const langName = LANG_NAMES[language] || "English";

    // Report conditions take priority; merge with any manually-entered ones
    const allConditions = [
      ...new Set([
        ...safeArray(reportConditions),
        ...safeArray(healthInfo.medical_conditions),
      ]),
    ];

    const context = `
User details:
- Age group: ${userProfile.ageGroup || "Not specified"}
- Gender: ${userProfile.gender || "Not specified"}
- Height: ${healthInfo.height || "?"} inches, Weight: ${healthInfo.weight || "?"} kg
- Medical conditions: ${allConditions.join(", ") || "None"}
- Health goals: ${safeArray(goals.tags).join(", ") || "General fitness"}
- Focus body parts: ${safeArray(goals.focus_body_parts).join(", ") || "Not specified"}${
      reportSummary
        ? `\n- Medical report summary: ${reportSummary}`
        : ""
    }`;

    const prompt = `You are a certified Indian nutritionist working inside a yoga app. Create a one-day Indian diet plan that supports this user's yoga practice, health conditions and goals.

${context}

Rules:
- Common, affordable INDIAN foods (dal, roti, sabzi, poha, idli, fruits, buttermilk, etc.). Vegetarian by default.
- Respect the medical conditions (e.g. low sugar for diabetes, low salt for high BP, anti-inflammatory for arthritis, iodine awareness for thyroid, low-GI for PCOS).
- Every list item must be ONE short line.
- ALL text values must be written in ${langName}.

Return ONLY valid JSON with exactly these keys:
{
  "daily_guidelines": [3-4 short tips],
  "meals": {
    "breakfast": [2-3 items],
    "mid_morning": [1-2 items],
    "lunch": [3-4 items],
    "evening_snack": [1-2 items],
    "dinner": [2-3 items]
  },
  "foods_to_avoid": [3-5 items],
  "hydration": "one line about water/fluids",
  "note": "one line disclaimer to consult a dietician/doctor for medical diets"
}`;

    const reply = await chatCompletion(
      [{ role: "user", content: prompt }],
      { jsonMode: true, temperature: 0.4 },
    );

    const plan = parseJsonReply(reply);

    if (!plan) {
      // fall back to raw text so the app can still show something
      return res.json({ plan: null, planText: reply || "" });
    }

    return res.json({ plan });
  } catch (err) {
    console.error("DIET ERROR:", err.response?.status, err.message);
    return res.status(500).json({ message: "Diet recommendation failed" });
  }
});

/* Short, targeted food advice for a specific complaint (voice-friendly) */
router.post("/food-for", async (req, res) => {
  try {
    const { concern = "", language = "en" } = req.body || {};
    const langName = LANG_NAMES[language] || "English";
    if (!concern.trim()) {
      return res.status(400).json({ message: "No concern provided" });
    }

    const prompt = `A user says: "${concern}". As an Indian nutritionist, give SHORT, practical food advice for this.

Reply in ${langName}. Maximum 3 short sentences. Say: 2-3 foods that help, and 1-2 foods to avoid. Common Indian foods. No long explanation, no headings, no preamble — just the direct advice a friend would say aloud.`;

    const reply = await chatCompletion([{ role: "user", content: prompt }], {
      temperature: 0.4,
    });

    return res.json({ advice: (reply || "").trim() });
  } catch (err) {
    console.error("FOOD-FOR ERROR:", err.message);
    return res.status(500).json({ message: "Could not get food advice" });
  }
});

module.exports = router;
