const express = require("express");
const { chatCompletion, parseJsonReply } = require("../utils/mistralClient");

const router = express.Router();

const LANG_NAMES = { en: "English", mr: "Marathi", hn: "Hindi" };

function safeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

/* Current Indian season, used by the Ayurveda approach for seasonal foods. */
function indianSeason() {
  const m = new Date().getMonth(); // 0 = Jan
  if (m === 11 || m <= 1) return "Winter (Hemant/Shishir)";
  if (m >= 2 && m <= 3) return "Spring (Vasant)";
  if (m >= 4 && m <= 5) return "Summer (Grishma)";
  if (m >= 6 && m <= 8) return "Monsoon (Varsha)";
  return "Autumn (Sharad)";
}

/* Three schools of diet. App leans towards Ayurveda / Naturopathy (default). */
function dietApproachBlock(dietType) {
  const season = indianSeason();
  switch (dietType) {
    case "medical":
      return {
        title: "Modern Medical Nutrition (deficiency focused)",
        block: `APPROACH: Modern evidence based medical nutrition, focused on correcting likely nutritional DEFICIENCIES.
- From the medical conditions and report, infer the probable deficiencies (iron, vitamin B12, vitamin D, calcium, protein, fibre, omega-3) and target foods rich in exactly those nutrients.
- Be macro and micronutrient aware. Prefer whole grains, dals, leafy greens, nuts, seeds, dairy or fortified foods.
- Keep it practical and affordable Indian food, vegetarian by default.`,
      };
    case "naturopathy":
      return {
        title: "Naturopathy (natural living foods)",
        block: `APPROACH: Naturopathy, healing through nature.
- Emphasise natural, whole, plant based and living foods: raw fruits, fresh salads, sprouts, soaked nuts, fresh vegetable and fruit juices, coconut water.
- Minimal cooking, no refined sugar, no maida, no fried or processed food.
- Favour alkaline foods, warm water on waking, and an early light dinner. Gentle detox friendly choices.`,
      };
    case "ayurveda":
    default:
      return {
        title: "Ayurveda (seasonal and dosha balancing)",
        block: `APPROACH: Ayurveda, eating in tune with the season and the doshas.
- Current Indian season: ${season}. Favour foods that suit THIS season (warm, freshly cooked, easy to digest in monsoon and winter; cooling and hydrating in summer).
- Balance Vata, Pitta and Kapha. Use sattvic foods and warming spices like ginger, turmeric, cumin, ajwain and jeera.
- Largest meal at midday, a light dinner before sunset, sip warm water. Include the six tastes across the day.`,
      };
  }
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
      dietType = "ayurveda",
    } = req.body || {};

    const langName = LANG_NAMES[language] || "English";
    const approach = dietApproachBlock(dietType);

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

    const prompt = `You are a certified Indian nutritionist working inside a yoga app. Create a one-day Indian diet plan that supports this user's yoga practice, health conditions and goals, following the specific approach below.

${approach.block}

${context}

Rules:
- Stay true to the APPROACH above. Common, affordable INDIAN foods. Vegetarian by default.
- Respect the medical conditions (e.g. low sugar for diabetes, low salt for high BP, anti-inflammatory for arthritis, iodine awareness for thyroid, low-GI for PCOS, iron and calcium rich for pregnancy or post pregnancy).
- Every list item must be ONE short line.
- ALL text values must be written in ${langName}.

Return ONLY valid JSON with exactly these keys:
{
  "approach_note": "one short line naming this approach and its idea, in ${langName}",
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
      return res.json({
        plan: null,
        planText: reply || "",
        approach: dietType,
        approachTitle: approach.title,
      });
    }

    // Tag the plan with which school produced it (drives the UI selector).
    plan.approach = dietType;
    plan.approach_title = approach.title;

    return res.json({ plan, approach: dietType, approachTitle: approach.title });
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
