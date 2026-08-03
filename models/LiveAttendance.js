const mongoose = require("mongoose");

/* One record per time a user attends a live class (for their history). */
const LiveAttendanceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    classId: { type: String, required: true },
    title: { type: String, default: "Live class" },
    instructorName: { type: String, default: "Instructor" },
    minutes: { type: Number, default: 0 },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("LiveAttendance", LiveAttendanceSchema);
