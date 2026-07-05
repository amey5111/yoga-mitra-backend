const axios = require("axios");
require("dotenv").config();

const API_KEY = process.env.MISTRAL_API_KEY;
const CHAT_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const VISION_MODEL = process.env.MISTRAL_VISION_MODEL || "pixtral-12b-2409";
const OCR_MODEL = process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest";

const BASE_URL = "https://api.mistral.ai/v1";

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

/* Robustly pull a JSON object out of a model reply (handles ```json fences) */
function parseJsonReply(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, "").replace(/```/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

async function chatCompletion(messages, opts = {}) {
  const body = {
    model: opts.model || CHAT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const resp = await axios.post(`${BASE_URL}/chat/completions`, body, {
    headers,
    timeout: opts.timeout || 90000,
  });
  return resp.data?.choices?.[0]?.message?.content || "";
}

/* OCR a document (PDF or image) passed as a data URI. Returns markdown text. */
async function ocrDocument(dataUri, isPdf) {
  const document = isPdf
    ? { type: "document_url", document_url: dataUri }
    : { type: "image_url", image_url: dataUri };

  const resp = await axios.post(
    `${BASE_URL}/ocr`,
    { model: OCR_MODEL, document },
    { headers, timeout: 120000 },
  );

  const pages = resp.data?.pages || [];
  return pages.map((p) => p.markdown || "").join("\n\n").trim();
}

/* Ask the vision model a question about an image directly (fallback path). */
async function visionCompletion(dataUri, prompt, opts = {}) {
  return chatCompletion(
    [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: dataUri },
        ],
      },
    ],
    { model: VISION_MODEL, jsonMode: opts.jsonMode, timeout: 120000 },
  );
}

module.exports = {
  chatCompletion,
  ocrDocument,
  visionCompletion,
  parseJsonReply,
};
