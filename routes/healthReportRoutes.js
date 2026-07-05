const express = require("express");
const {
  chatCompletion,
  ocrDocument,
  visionCompletion,
  parseJsonReply,
} = require("../utils/mistralClient");

const router = express.Router();

const KNOWN_CONDITIONS = [
  "Diabetes",
  "Thyroid",
  "High BP",
  "PCOS",
  "Arthritis",
  "Asthma",
  "Leg Injury",
];

/* Map common report terminology onto the app's condition chips */
const SYNONYMS = {
  diabetes: "Diabetes",
  "diabetes mellitus": "Diabetes",
  "type 2 diabetes": "Diabetes",
  "type 1 diabetes": "Diabetes",
  hyperglycemia: "Diabetes",
  prediabetes: "Diabetes",
  thyroid: "Thyroid",
  hypothyroid: "Thyroid",
  hypothyroidism: "Thyroid",
  hyperthyroid: "Thyroid",
  hyperthyroidism: "Thyroid",
  "high bp": "High BP",
  "high blood pressure": "High BP",
  hypertension: "High BP",
  pcos: "PCOS",
  pcod: "PCOS",
  "polycystic ovary syndrome": "PCOS",
  arthritis: "Arthritis",
  osteoarthritis: "Arthritis",
  "rheumatoid arthritis": "Arthritis",
  "joint pain": "Arthritis",
  asthma: "Asthma",
  "bronchial asthma": "Asthma",
  "leg injury": "Leg Injury",
  "knee injury": "Leg Injury",
  "ankle injury": "Leg Injury",
  "leg fracture": "Leg Injury",
};

function normalizeConditions(rawList) {
  const known = new Set();
  const other = [];
  for (const raw of rawList || []) {
    const key = String(raw).trim().toLowerCase();
    if (!key) continue;
    const mapped =
      SYNONYMS[key] ||
      KNOWN_CONDITIONS.find((k) => k.toLowerCase() === key) ||
      null;
    if (mapped) known.add(mapped);
    else other.push(String(raw).trim());
  }
  return { known: [...known], other };
}

const LANG_NAMES = { en: "English", mr: "Marathi", hn: "Hindi" };

function extractionPrompt(reportText, language) {
  const langName = LANG_NAMES[language] || "English";
  return `You are a medical report analyst for a yoga app. Analyze the medical report below and extract health information relevant for planning safe yoga practice.

Return ONLY valid JSON with exactly these keys:
{
  "conditions": [list of medical conditions/diagnoses found, as short English terms like "Diabetes", "Hypertension", "Hypothyroidism", "Asthma", "Arthritis", "PCOS", "Knee injury"],
  "summary": "2-3 sentence plain-language summary of the report in ${langName}, understandable by a non-doctor",
  "cautions": "1-2 sentences in ${langName} about what this person should be careful about during yoga practice"
}

Rules:
- Only list conditions actually indicated in the report (diagnoses, abnormal values clearly out of range, stated history).
- Do NOT invent conditions. If the report is normal, return an empty conditions list and say so in the summary.
- Keep condition names short and standard.

MEDICAL REPORT:
${reportText}`;
}

router.post("/analyze", async (req, res) => {
  try {
    const { fileBase64, mimeType, language = "en" } = req.body || {};

    if (!fileBase64 || !mimeType) {
      return res
        .status(400)
        .json({ message: "fileBase64 and mimeType are required" });
    }

    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    if (!allowed.includes(mimeType)) {
      return res.status(400).json({
        message: "Unsupported file type. Upload a PDF, JPG, PNG or WEBP.",
      });
    }

    // ~10 MB binary ≈ 13.7M base64 chars
    if (fileBase64.length > 14_000_000) {
      return res
        .status(400)
        .json({ message: "File too large. Maximum size is 10 MB." });
    }

    const isPdf = mimeType === "application/pdf";
    const dataUri = `data:${mimeType};base64,${fileBase64}`;

    let extracted = null;

    // Path 1: OCR → text → extraction chat
    try {
      const text = await ocrDocument(dataUri, isPdf);
      if (text && text.length > 10) {
        const reply = await chatCompletion(
          [{ role: "user", content: extractionPrompt(text, language) }],
          { jsonMode: true },
        );
        extracted = parseJsonReply(reply);
      }
    } catch (ocrErr) {
      console.log("OCR path failed:", ocrErr.response?.status, ocrErr.message);
    }

    // Path 2 (images only): direct vision model fallback
    if (!extracted && !isPdf) {
      try {
        const reply = await visionCompletion(
          dataUri,
          extractionPrompt("(see attached report image)", language),
          { jsonMode: true },
        );
        extracted = parseJsonReply(reply);
      } catch (visionErr) {
        console.log(
          "Vision path failed:",
          visionErr.response?.status,
          visionErr.message,
        );
      }
    }

    if (!extracted) {
      return res.status(502).json({
        message:
          "Could not analyze the report. Try a clearer photo or a text-based PDF.",
      });
    }

    const { known, other } = normalizeConditions(extracted.conditions);

    return res.json({
      knownConditions: known, // matches the app's condition chips
      otherConditions: other, // free-text extras
      summary: extracted.summary || "",
      cautions: extracted.cautions || "",
    });
  } catch (err) {
    console.error("HEALTH REPORT ERROR:", err.message);
    return res.status(500).json({ message: "Report analysis failed" });
  }
});

module.exports = router;
