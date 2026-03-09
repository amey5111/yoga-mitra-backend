const axios = require("axios");
const YogaPose = require("../models/YogaPose");
const BreathingTechnique = require("../models/BreathingTechnique");
require("dotenv").config();

const apiKey = process.env.MISTRAL_API_KEY;
const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

const log = (...args) => console.log("[AI-RECOMMENDER]", ...args);

function safeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function getEnglishArray(field) {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  if (field.en) return safeArray(field.en);
  return [];
}

/* ---------------- CONDITION NORMALIZATION ---------------- */

function normalizeMedicalConditions(conditions) {
  const map = {
    diabetes: "diabetes",
    thyroid: "thyroid",
    "high bp": "high_blood_pressure",
    "high blood pressure": "high_blood_pressure",
    pcos: "pcos",
    arthritis: "arthritis",
    asthma: "asthma",
    "leg injury": "leg_injury",
  };

  return safeArray(conditions).map((c) => {
    const key = String(c).toLowerCase();
    return map[key] || key;
  });
}

/* ---------------- CONDITION → BODY PART MAP ---------------- */

const conditionBodyPartMap = {
  diabetes: ["abdomen"],
  thyroid: ["neck"],
  high_blood_pressure: ["heart"],
  pcos: ["abdomen"],
  arthritis: ["knee", "shoulder", "wrist"],
  asthma: ["chest"],
  leg_injury: ["knee"],
};

/* ---------------- SCORE CALCULATION ---------------- */

function calculateScore(item, healthInfo, goals) {
  let score = 0;

  const goalTags = safeArray(goals.tags).map((t) =>
    String(t).toLowerCase().replace(/\s+/g, "_"),
  );

  const bodyParts = safeArray(goals.focus_body_parts).map((b) =>
    String(b).toLowerCase(),
  );

  const medical = normalizeMedicalConditions(healthInfo.medical_conditions);

  const level = String(healthInfo.activity_level || "").toLowerCase();

  const itemTags = safeArray(item.tags).map((t) => String(t).toLowerCase());

  const benefitTags = safeArray(item.benefit_tags).map((t) =>
    String(t).toLowerCase(),
  );

  const contraTags = safeArray(item.contraindication_tags).map((t) =>
    String(t).toLowerCase(),
  );

  const itemParts = getEnglishArray(item.target_body_parts).map((b) =>
    String(b).toLowerCase(),
  );

  const benefitText = getEnglishArray(item.primary_benefits)
    .join(" ")
    .toLowerCase();

  /* ---------- CONTRAINDICATION FILTER ---------- */

  for (const cond of medical) {
    if (contraTags.includes(cond)) {
      return -Infinity;
    }
  }

  /* ---------- GOAL MATCH (+5) ---------- */

  goalTags.forEach((tag) => {
    if (benefitTags.includes(tag)) score += 5;
  });

  /* ---------- BODY PART MATCH (+3) ---------- */

  bodyParts.forEach((part) => {
    if (itemParts.includes(part)) score += 3;
  });

  /* ---------- MEDICAL CONDITION BENEFIT (+6) ---------- */

  medical.forEach((cond) => {
    if (benefitTags.includes(`${cond}_support`)) score += 6;
    if (benefitTags.includes(`${cond}_relief`)) score += 6;
  });

  /* ---------- CONDITION → BODY PART BOOST ---------- */

  medical.forEach((cond) => {
    const mappedParts = conditionBodyPartMap[cond] || [];
    mappedParts.forEach((part) => {
      if (itemParts.includes(part)) score += 3;
    });
  });

  /* ---------- BENEFIT TEXT MATCH (+2) ---------- */

  goalTags.forEach((tag) => {
    const readable = tag.replace("_", " ");
    if (benefitText.includes(readable)) score += 2;
  });

  /* ---------- DIFFICULTY MATCH (+2) ---------- */

  const difficulty = String(item.difficulty_level?.en || "").toLowerCase();

  const levelOrder = {
    beginner: 1,
    intermediate: 2,
    advanced: 3,
  };

  const userLevel = levelOrder[level] || 1;

  const poseLevels = difficulty
    .split("/")
    .map((l) => l.trim())
    .map((l) => levelOrder[l] || 1);

  const poseLevel = Math.max(...poseLevels);

  if (userLevel >= poseLevel) {
    score += 2;
  }

  return score;
}

function cleanJSONString(jsonString) {
  jsonString = jsonString.replace(/\/\/.*$/gm, "");
  jsonString = jsonString.replace(/,\s*}/g, "}");
  jsonString = jsonString.replace(/,\s*]/g, "]");
  return jsonString;
}

/* ---------------- AI RECOMMENDATION ---------------- */

async function callAIRecommendations(userProfile, healthInfo, goals) {
  try {
    const yogaRaw = await YogaPose.find({}).lean();
    const breathingRaw = await BreathingTechnique.find({}).lean();

    const scoredYoga = yogaRaw
      .map((pose) => ({
        ...pose,
        score: calculateScore(pose, healthInfo, goals),
      }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    const scoredBreathing = breathingRaw
      .map((item) => ({
        ...item,
        score: calculateScore(item, healthInfo, goals),
      }))
      .filter((b) => b.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    if (!apiKey) {
      return [
        ...scoredYoga.slice(0, 10).map((p) => ({ id: p.id })),
        ...scoredBreathing.slice(0, 5).map((b) => ({
          id: b.id,
          type: "breathing",
        })),
      ];
    }

    const userContext = `
User Profile:
- Age: ${userProfile.age || "Not specified"}
- Gender: ${userProfile.gender || "Not specified"}
- Activity Level: ${healthInfo.activity_level || "Not specified"}
- Medical Conditions: ${safeArray(healthInfo.medical_conditions).join(", ") || "None"}
- Goals: ${safeArray(goals.tags).join(", ") || "General Fitness"}
- Focus Body Parts: ${safeArray(goals.focus_body_parts).join(", ") || "Not specified"}
`;

    const yogaList = scoredYoga
      .map((p) => `ID ${p.id} - ${p.name?.en}`)
      .join("\n");

    const breathingList = scoredBreathing
      .map((b) => `ID ${b.id} - ${b.name?.en}`)
      .join("\n");

    const prompt = `
You are a certified Indian yoga therapist writing recommendations for real Indian users.

TASK:

1) Select EXACTLY 10 yoga poses.
2) Select EXACTLY 5 breathing techniques.
3) Choose ONLY from the provided list.

For EACH selected item generate a SHORT reason based on the USER CONTEXT.

REASON GENERATION RULES (VERY IMPORTANT):

The reason MUST be based on ONE of these:

1️⃣ Medical condition

Example patterns:

EN: Best pick for diabetes management  
MR: मधुमेह नियंत्रणासाठी उपयुक्त  
HN: मधुमेह नियंत्रण में सहायक  

EN: Helps reduce back pain  
MR: पाठदुखी कमी करण्यास मदत करते  
HN: पीठ दर्द कम करने में मदद करता है  

EN: Helpful for knee pain relief  
MR: गुडघ्यांवरील ताण कमी करते  
HN: घुटनों के दर्द में राहत देता है  


2️⃣ Health goal

EN: Improves flexibility  
MR: लवचिकता वाढवते  
HN: लचीलापन बढ़ाने में मदद करता है  

EN: Reduces stress and anxiety  
MR: तणाव कमी करण्यास मदत करते  
HN: तनाव कम करने में सहायक है  

EN: Supports weight loss  
MR: वजन कमी करण्यास मदत करते  
HN: वजन कम करने में सहायक है  


3️⃣ Focus body part

EN: Strengthens back muscles  
MR: पाठीचे स्नायू मजबूत करते  
HN: पीठ की मांसपेशियों को मजबूत करता है  

EN: Improves hip flexibility  
MR: नितंबांची लवचिकता वाढवते  
HN: कूल्हों की लचीलापन बढ़ाता है  


LANGUAGE RULES (STRICT):

For Marathi:
- Use natural spoken Marathi
- Avoid literal translation
- Use correct grammar

Examples of GOOD Marathi:
- पाठदुखी कमी करण्यास मदत करते
- तणाव कमी करण्यास मदत करते
- लवचिकता वाढवते
- गुडघ्यांवरील ताण कमी करते

For Hindi:
- Use simple natural Hindi
- Avoid translation style sentences

Examples of GOOD Hindi:
- पीठ दर्द कम करने में मदद करता है
- तनाव कम करने में सहायक है
- लचीलापन बढ़ाने में मदद करता है
- घुटनों के दर्द में राहत देता है


STRUCTURE RULES:

- Maximum 8 words per language
- Marathi and Hindi must sound natural
- Do NOT translate word-by-word
- Write like a native Indian speaker
- Avoid English words inside Hindi or Marathi

Return ONLY valid JSON.


FORMAT STRICTLY:

{
 "poses": [
   {
     "id": number,
     "reason": {
        "en": "...",
        "mr": "...",
        "hn": "..."
     }
   }
 ],
 "breathing": [
   {
     "id": number,
     "reason": {
        "en": "...",
        "mr": "...",
        "hn": "..."
     }
   }
 ]
}

User Profile:
${userContext}

Available Yoga:
${yogaList}

Available Breathing:
${breathingList}
`;

    const resp = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const content = resp.data?.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Invalid AI JSON");

    const aiResult = JSON.parse(cleanJSONString(match[0]));

    return [
      ...safeArray(aiResult.poses)
        .slice(0, 10)
        .map((p) => ({ id: p.id, reason: p.reason })),
      ...safeArray(aiResult.breathing)
        .slice(0, 5)
        .map((b) => ({ id: b.id, type: "breathing", reason: b.reason })),
    ];
  } catch (err) {
    console.log("AI ERROR:", err.message);
    return [];
  }
}

module.exports = { callAIRecommendations };
