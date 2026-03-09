const mongoose = require("mongoose");

const ContraSchema = new mongoose.Schema(
  {
    condition: String,
    advice: String,
  },
  { _id: false },
);

const ModSchema = new mongoose.Schema(
  {
    type: String,
    advice: String,
  },
  { _id: false },
);

const LangStringSchema = new mongoose.Schema(
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

const YogaPoseSchema = new mongoose.Schema(
  {
    id: Number,
    name: LangStringSchema,
    name_sanskrit: String,
    alternate_names: [String],
    difficulty_level: LangStringSchema,
    duration_seconds: Number,
    repetitions: Number,
    primary_benefits: LangStringSchema,
    detailed_benefits: LangStringSchema,
    target_body_parts: LangStringSchema,
    contraindications: {
      en: [ContraSchema],
      hn: [ContraSchema],
      mr: [ContraSchema],
    },
    precautions: LangStringSchema,
    modifications: {
      en: [ModSchema],
      hn: [ModSchema],
      mr: [ModSchema],
    },
    instructions: LangStringSchema,
    breathing_cues: LangStringSchema,
    props_needed: LangStringSchema,
    time_of_practice: LangStringSchema,
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
  { collection: "yoga" },
);

module.exports = mongoose.model("YogaPose", YogaPoseSchema);
