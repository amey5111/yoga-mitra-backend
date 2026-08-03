const mongoose = require("mongoose");

/* A single question asked by a viewer during a live class. */
const QuestionSchema = new mongoose.Schema(
  {
    userId: { type: String, default: "" },
    userName: { type: String, default: "Guest" },
    text: { type: String, required: true },
    answered: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/* A viewer who raised a hand to come on video/audio. */
const RaisedHandSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    userName: { type: String, default: "Guest" },
    approved: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const LiveClassSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },

    instructorId: { type: String, required: true },
    instructorName: { type: String, default: "Instructor" },

    // Agora RTC channel (unique per class). The client joins this channel.
    channelName: { type: String, required: true, unique: true },

    // scheduled -> live -> ended
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
    },

    scheduledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    // Approved speakers (raised hand + instructor accepted). Their app upgrades
    // its Agora role to broadcaster so their camera/mic go live.
    speakers: { type: [String], default: [] },

    questions: { type: [QuestionSchema], default: [] },
    raisedHands: { type: [RaisedHandSchema], default: [] },

    // Who is currently in the room (for the Meet-style participants panel).
    participants: {
      type: [
        {
          userId: String,
          userName: { type: String, default: "Guest" },
          onStage: { type: Boolean, default: false },
        },
      ],
      default: [],
    },

    attendeesCount: { type: Number, default: 0 },

    // Agora Cloud Recording -> external cloud storage. Nothing is stored in app.
    recording: {
      isRecording: { type: Boolean, default: false },
      resourceId: { type: String, default: "" },
      sid: { type: String, default: "" },
      uid: { type: String, default: "" },
    },
    // Playable URL of the finished recording (in external storage / CDN).
    recordingUrl: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("LiveClass", LiveClassSchema);
