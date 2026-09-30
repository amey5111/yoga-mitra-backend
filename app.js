const express = require("express");
const cors = require("cors");
const path = require("path");

/**
 * Builds the Express app WITHOUT connecting to Mongo or binding a port.
 * server.js does those two things; tests import this file directly so they
 * can run the real routes against an in-memory Mongo.
 */
const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/recommendations", require("./routes/recommendationRoutes"));
app.use("/api/poses", require("./routes/poseRoutes"));
app.use("/api/breathing", require("./routes/breathingRoutes"));
// Anchored to this file, not the working directory, so uploaded lesson media
// is still found when the server is started from somewhere else.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/routine", require("./routes/routineRoutes"));
app.use("/api/pose-tracking", require("./routes/poseTrackingRoutes"));
app.use("/api/health-report", require("./routes/healthReportRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/diet", require("./routes/dietRoutes"));
app.use("/api/user", require("./routes/userRoutes"));
app.use("/api/session", require("./routes/sessionFeedbackRoutes"));
app.use("/api/live", require("./routes/liveClassRoutes"));
app.use("/api/profile", require("./routes/profileRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));

app.get("/", (_req, res) => {
  res.send("Yoga Mitra Backend Running");
});

module.exports = app;
