const mongoose = require("mongoose");

const PoseSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },

    poseId: {
      type: Number,
      required: true,
    },

    poseName: {
      type: String,
      default: "",
    },

    score: {
      type: Number,
      default: 0,
    },

    avgSimilarity: {
      type: Number,
      default: 0,
    },

    durationAchieved: {
      type: Number,
      default: 0,
    },

    completed: {
      type: Boolean,
      default: false,
    },

    mistakes: {
      type: [String],
      default: [],
    },

    level: {
      type: String,
      default: "beginner",
    },

    sessionDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("PoseSession", PoseSessionSchema);
