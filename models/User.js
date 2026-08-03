const mongoose = require("mongoose");

const RoutineStepSchema = new mongoose.Schema(
  {
    order: Number,
    type: String,
    id: Number,
    duration: Number,
  },
  { _id: false },
);

const RoutineSchema = new mongoose.Schema(
  {
    total_duration: Number,
    routine: [RoutineStepSchema],
  },
  { _id: false },
);

// ── NEW: store each recommendation with its reason ──────────────────────────
const RecommendationItemSchema = new mongoose.Schema(
  {
    id: Number,
    type: String, // "breathing" or null/undefined for pose
    reason: mongoose.Schema.Types.Mixed, // { en, mr, hn }
    name: mongoose.Schema.Types.Mixed,
    image_url: String,
    duration_seconds: Number,
    repetitions: Number,
    primary_benefits: mongoose.Schema.Types.Mixed,
    difficulty_level: mongoose.Schema.Types.Mixed,
    video: mongoose.Schema.Types.Mixed,
  },
  { _id: false },
);

// ── Persisted health profile (height/weight/conditions/activity) ────────────
const HealthProfileSchema = new mongoose.Schema(
  {
    height: Number,
    weight: Number,
    activityLevel: String,
    medicalConditions: [String],
    focusBodyParts: [String],
    goalTags: [String],
    routineDuration: Number,
  },
  { _id: false },
);

// ── AI-analyzed medical report ──────────────────────────────────────────────
const MedicalReportSchema = new mongoose.Schema(
  {
    knownConditions: [String],
    otherConditions: [String],
    summary: String,
    cautions: String,
    fileName: String,
    uploadedAt: Date,
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    ageGroup: String,
    gender: String,

    // "user" (default) or "instructor" — drives a completely separate experience
    role: { type: String, enum: ["user", "instructor"], default: "user" },

    // Instructor public profile
    bio: { type: String, default: "" },
    specialty: { type: String, default: "" },
    photo: { type: String, default: "" }, // base64 data URL

    routine: RoutineSchema,

    // ── NEW ──────────────────────────────────────────────────────────────────
    savedPoseRecommendations: [RecommendationItemSchema],
    savedBreathingRecommendations: [RecommendationItemSchema],

    // ── Persisted health + medical report ─────────────────────────────────────
    healthProfile: HealthProfileSchema,
    medicalReport: MedicalReportSchema,
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
