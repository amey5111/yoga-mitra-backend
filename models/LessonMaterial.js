const mongoose = require("mongoose");

/**
 * One item in a class's lesson plan.
 *
 * An instructor builds a class up from these: written notes, ordered
 * instructions to follow along with, and media (audio, video, images, PDFs)
 * either uploaded to the server or linked from elsewhere.
 *
 * Kept in its own collection rather than embedded in LiveClass so a lesson
 * plan can grow without bloating the document that every live poll reads.
 */
const LessonMaterialSchema = new mongoose.Schema(
  {
    classId: { type: String, required: true, index: true },
    instructorId: { type: String, required: true },

    kind: {
      type: String,
      enum: ["note", "instruction", "link", "audio", "video", "image", "pdf"],
      default: "note",
    },

    title: { type: String, default: "" },

    // The written content: the note itself, or what to do in this step.
    body: { type: String, default: "" },

    // Where the media lives — an uploaded file under /uploads/materials, or an
    // external link the instructor pasted.
    url: { type: String, default: "" },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },

    // How long this step should take, or how long the clip runs.
    durationSeconds: { type: Number, default: 0 },

    // Position in the plan. Lower comes first.
    order: { type: Number, default: 0 },

    // Instructors can draft an item before students can see it.
    publishedToStudents: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/* The plan is always read as "this class, in order". */
LessonMaterialSchema.index({ classId: 1, order: 1 });

module.exports = mongoose.model("LessonMaterial", LessonMaterialSchema);
