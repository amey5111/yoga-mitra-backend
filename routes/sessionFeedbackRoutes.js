const express = require("express");
const { chatCompletion, parseJsonReply } = require("../utils/mistralClient");
const PoseSession = require("../models/PoseSession");

const router = express.Router();

const LANG_NAMES = { en: "English", mr: "Marathi", hn: "Hindi" };

function safeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

/* Deterministic fallback feedback if the AI is unavailable */
function fallbackFeedback(results, lang) {
  const correct = results.filter((r) => r.completed).map((r) => r.poseName);
  const needWork = results
    .filter((r) => !r.completed)
    .map((r) => r.poseName);
  const avg =
    results.reduce((s, r) => s + (r.avgSimilarity || 0), 0) /
    Math.max(results.length, 1);

  const L = {
    en: {
      summary: `You practiced ${results.length} pose(s) with an average accuracy of ${Math.round(avg)}%.`,
      mistakes: needWork.length
        ? ["Some poses were not held long enough at good alignment."]
        : ["No major mistakes detected. Great control!"],
      improvements: needWork.length
        ? [`Work on holding: ${needWork.join(", ")}.`]
        : ["Keep refining your alignment for even higher accuracy."],
      suggestions: [
        "Warm up before practice.",
        "Hold each pose steady and breathe evenly.",
        "Practice regularly to build consistency.",
      ],
      encouragement: "Great effort — keep it up! 🧘",
    },
    mr: {
      summary: `तुम्ही ${results.length} आसने केली, सरासरी अचूकता ${Math.round(avg)}%.`,
      mistakes: needWork.length
        ? ["काही आसने योग्य स्थितीत पुरेशी धरली गेली नाहीत."]
        : ["मोठ्या चुका आढळल्या नाहीत. उत्तम!"],
      improvements: needWork.length
        ? [`यावर काम करा: ${needWork.join(", ")}.`]
        : ["अचूकता वाढवण्यासाठी संरेखनावर लक्ष द्या."],
      suggestions: [
        "सरावापूर्वी वॉर्म-अप करा.",
        "प्रत्येक आसन स्थिर धरा व समान श्वास घ्या.",
        "नियमित सराव करा.",
      ],
      encouragement: "छान प्रयत्न — असेच सुरू ठेवा! 🧘",
    },
    hn: {
      summary: `आपने ${results.length} आसन किए, औसत सटीकता ${Math.round(avg)}%.`,
      mistakes: needWork.length
        ? ["कुछ आसन सही स्थिति में पर्याप्त देर तक नहीं टिके."]
        : ["कोई बड़ी गलती नहीं मिली. बहुत बढ़िया!"],
      improvements: needWork.length
        ? [`इन पर काम करें: ${needWork.join(", ")}.`]
        : ["सटीकता बढ़ाने के लिए संरेखण पर ध्यान दें."],
      suggestions: [
        "अभ्यास से पहले वार्म-अप करें.",
        "हर आसन को स्थिर रखें और समान श्वास लें.",
        "नियमित अभ्यास करें.",
      ],
      encouragement: "बढ़िया प्रयास — जारी रखें! 🧘",
    },
  };
  const t = L[lang] || L.en;
  return {
    overall_score: Math.round(avg),
    poses_correct: correct,
    performance_summary: t.summary,
    mistakes: t.mistakes,
    improvements: t.improvements,
    suggestions: t.suggestions,
    encouragement: t.encouragement,
  };
}

router.post("/feedback", async (req, res) => {
  try {
    const { results = [], userId, language = "en" } = req.body || {};
    const langName = LANG_NAMES[language] || "English";

    const cleaned = safeArray(results).map((r) => ({
      poseName: r.poseName || "Unknown pose",
      avgSimilarity: Math.round(r.avgSimilarity || 0),
      bestSimilarity: Math.round(r.bestSimilarity || 0),
      durationAchieved: r.durationAchieved || 0,
      targetDuration: r.targetDuration || 15,
      completed: !!r.completed,
      mistakes: safeArray(r.mistakes),
    }));

    if (cleaned.length === 0) {
      return res.status(400).json({ message: "No session results provided" });
    }

    // Persist each pose attempt (best-effort)
    if (userId) {
      Promise.all(
        cleaned.map((r, i) =>
          PoseSession.create({
            userId,
            poseId: results[i]?.poseId ?? 0,
            poseName: r.poseName,
            score: r.bestSimilarity,
            avgSimilarity: r.avgSimilarity,
            durationAchieved: r.durationAchieved,
            completed: r.completed,
            mistakes: r.mistakes,
            level: results[i]?.level || "beginner",
          }),
        ),
      ).catch((e) => console.log("Session save error:", e.message));
    }

    const sessionText = cleaned
      .map(
        (r, i) =>
          `${i + 1}. ${r.poseName}: avg accuracy ${r.avgSimilarity}%, best ${r.bestSimilarity}%, held ${r.durationAchieved}/${r.targetDuration}s, ${r.completed ? "COMPLETED" : "NOT completed"}${r.mistakes.length ? ", issues: " + r.mistakes.join("; ") : ""}`,
      )
      .join("\n");

    const prompt = `You are a certified yoga instructor giving warm, encouraging post-session feedback to a student who just practiced using a camera-based pose checker.

SESSION DATA:
${sessionText}

Write personalized feedback in ${langName}. Be specific, positive, and practical. Base everything ONLY on the data above.

Return ONLY valid JSON with exactly these keys:
{
  "overall_score": number (0-100, overall performance for the whole session),
  "poses_correct": [names of poses done well / completed],
  "performance_summary": "2-3 warm sentences summarizing how the session went",
  "mistakes": [2-4 specific posture/practice mistakes observed, each one short line],
  "improvements": [2-4 specific areas to improve, each one short line],
  "suggestions": [3-4 actionable tips for future practice, each one short line],
  "encouragement": "one short motivating sentence with an emoji"
}

All text values MUST be in ${langName}. Keep each list item under 14 words.`;

    let feedback = null;
    try {
      const reply = await chatCompletion(
        [{ role: "user", content: prompt }],
        { jsonMode: true, temperature: 0.5 },
      );
      feedback = parseJsonReply(reply);
    } catch (aiErr) {
      console.log("Feedback AI error:", aiErr.response?.status, aiErr.message);
    }

    if (!feedback) feedback = fallbackFeedback(cleaned, language);

    return res.json({ feedback });
  } catch (err) {
    console.error("SESSION FEEDBACK ERROR:", err.message);
    return res.status(500).json({ message: "Feedback generation failed" });
  }
});

module.exports = router;
