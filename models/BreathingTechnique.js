const mongoose = require("mongoose");

const LangSchema = new mongoose.Schema(
  {
    en: mongoose.Schema.Types.Mixed,
    hn: mongoose.Schema.Types.Mixed,
    mr: mongoose.Schema.Types.Mixed,
  },
  { _id: false },
);

const VideoLangSchema = new mongoose.Schema(
  {
    youtube_url: String,
    channel_id: String,
    channel_name: String,
    duration_seconds: Number,
    license: String,
    published_at: String,
    thumbnail: String,
    title: String,
    video_id: String,
  },
  { _id: false },
);

const BreathingSchema = new mongoose.Schema(
  {
    id: Number,
    name: LangSchema,
    name_sanskrit: String,
    alternate_names: [String],
    category: LangSchema,
    difficulty_level: LangSchema,
    duration_seconds: Number,
    repetitions: Number,
    primary_benefits: LangSchema,
    detailed_benefits: LangSchema,
    target_systems: LangSchema,
    contraindications: LangSchema,
    precautions: LangSchema,
    modifications: LangSchema,
    instructions: LangSchema,
    breathing_pattern: LangSchema,
    focus_points: LangSchema,
    sound_or_mantra: LangSchema,
    props_needed: LangSchema,
    time_of_practice: LangSchema,
    evidence_level: String,
    source_references: [String],
    last_verified_date: String,
    notes_for_teachers: String,
    tags: [String],
    image_url: String,
    video: {
      en: VideoLangSchema,
      hn: VideoLangSchema,
      mr: VideoLangSchema,
    },
    benefit_tags: [String],
    contraindication_tags: [String],
  },
  { collection: "breathing_techniques" },
);

module.exports = mongoose.model("BreathingTechnique", BreathingSchema);
