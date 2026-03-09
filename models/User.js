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

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    ageGroup: String,
    gender: String,

    // NEW FIELD
    routine: RoutineSchema,
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
