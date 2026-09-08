/**
 * Validation and shaping for lesson plan items.
 *
 * Pure functions only — no Mongo, no Express — so the rules are unit testable
 * and the route layer stays thin.
 */

const KINDS = ["note", "instruction", "link", "audio", "video", "image", "pdf"];

/** Kinds that point at something rather than carrying text. */
const MEDIA_KINDS = ["link", "audio", "video", "image", "pdf"];

const MAX_TITLE = 200;
const MAX_BODY = 20000;
const MAX_URL = 2000;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

/** 25 MB — big enough for a guided-audio track, small enough to survive. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** What a student may upload as each kind of media. */
const ALLOWED_UPLOAD_MIME = [
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

class MaterialRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "MaterialRequestError";
    this.statusCode = 400;
  }
}

function isMediaKind(kind) {
  return MEDIA_KINDS.includes(kind);
}

/** The kind a file of this mime type should become. */
function kindForMime(mimeType) {
  const m = String(mimeType || "").toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  return null;
}

/**
 * Only ever hand the app an http(s) address or a path on this server.
 *
 * A pasted `javascript:` or `data:` URL would be handed straight to a webview
 * or url_launcher on the student's phone, so those never make it into the
 * database in the first place.
 */
function isSafeUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return false;
  if (url.length > MAX_URL) return false;
  // A server-relative path to something we uploaded.
  if (url.startsWith("/uploads/")) return !url.includes("..");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function cleanText(value, max, label) {
  const text = String(value ?? "").trim();
  if (text.length > max) {
    throw new MaterialRequestError(`${label} must be ${max} characters or less`);
  }
  return text;
}

function cleanDuration(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new MaterialRequestError("durationSeconds must be zero or more");
  }
  return Math.min(MAX_DURATION_SECONDS, Math.round(n));
}

/**
 * Validate an incoming lesson item and return the fields to persist.
 *
 * `partial` is used by PATCH: only the keys actually sent are validated and
 * returned, so an update never silently blanks a field it was not given.
 */
function normalizeMaterial(input = {}, { partial = false } = {}) {
  const out = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);

  let kind;
  if (has("kind") || !partial) {
    kind = String(input.kind || "note").trim();
    if (!KINDS.includes(kind)) {
      throw new MaterialRequestError(
        `kind must be one of: ${KINDS.join(", ")}`,
      );
    }
    out.kind = kind;
  }

  if (has("title") || !partial) {
    out.title = cleanText(input.title, MAX_TITLE, "title");
  }
  if (has("body") || !partial) {
    out.body = cleanText(input.body, MAX_BODY, "body");
  }
  if (has("url") || !partial) {
    const url = String(input.url ?? "").trim();
    if (url && !isSafeUrl(url)) {
      throw new MaterialRequestError("url must be an http(s) address");
    }
    out.url = url;
  }
  if (has("durationSeconds") || !partial) {
    out.durationSeconds = cleanDuration(input.durationSeconds);
  }
  if (has("publishedToStudents") || !partial) {
    out.publishedToStudents = input.publishedToStudents !== false;
  }
  if (has("order")) {
    const n = Number(input.order);
    if (!Number.isFinite(n)) {
      throw new MaterialRequestError("order must be a number");
    }
    out.order = Math.round(n);
  }
  if (has("fileName")) {
    out.fileName = cleanText(input.fileName, MAX_TITLE, "fileName");
  }
  if (has("mimeType")) {
    out.mimeType = cleanText(input.mimeType, MAX_TITLE, "mimeType");
  }

  // A full create must actually say something. On PATCH we can only judge the
  // fields we were handed, so the route re-checks against the merged document.
  if (!partial) assertHasContent(out);

  return out;
}

/** A lesson item has to carry either text or a destination. */
function assertHasContent(material) {
  const kind = material.kind || "note";
  if (isMediaKind(kind)) {
    if (!material.url) {
      throw new MaterialRequestError(`a ${kind} needs a url`);
    }
    return;
  }
  if (!material.title && !material.body) {
    throw new MaterialRequestError(`a ${kind} needs a title or some text`);
  }
}

/**
 * Apply an explicit ordering to a plan.
 *
 * Ids the client did not mention keep their relative order and go to the back,
 * so a stale client cannot silently drop items out of the plan.
 */
function resolveOrder(existingIds, orderedIds) {
  if (!Array.isArray(orderedIds)) {
    throw new MaterialRequestError("orderedIds must be an array");
  }
  const known = new Set(existingIds.map(String));
  const seen = new Set();
  const result = [];

  for (const raw of orderedIds) {
    const id = String(raw);
    if (!known.has(id)) {
      throw new MaterialRequestError(`unknown material id: ${id}`);
    }
    if (seen.has(id)) {
      throw new MaterialRequestError(`duplicate material id: ${id}`);
    }
    seen.add(id);
    result.push(id);
  }
  for (const id of existingIds.map(String)) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

/** What the app receives for one item. */
function toClient(doc) {
  return {
    id: String(doc._id || doc.id || ""),
    classId: String(doc.classId || ""),
    instructorId: String(doc.instructorId || ""),
    kind: doc.kind || "note",
    title: doc.title || "",
    body: doc.body || "",
    url: doc.url || "",
    fileName: doc.fileName || "",
    mimeType: doc.mimeType || "",
    sizeBytes: doc.sizeBytes || 0,
    durationSeconds: doc.durationSeconds || 0,
    order: doc.order || 0,
    publishedToStudents: doc.publishedToStudents !== false,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

module.exports = {
  KINDS,
  MEDIA_KINDS,
  MAX_TITLE,
  MAX_BODY,
  MAX_URL,
  MAX_UPLOAD_BYTES,
  MAX_DURATION_SECONDS,
  ALLOWED_UPLOAD_MIME,
  MaterialRequestError,
  isMediaKind,
  kindForMime,
  isSafeUrl,
  cleanDuration,
  normalizeMaterial,
  assertHasContent,
  resolveOrder,
  toClient,
};
