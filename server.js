const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");
const poseTrackingRoutes = require("./routes/poseTrackingRoutes");

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/recommendations", require("./routes/recommendationRoutes"));
app.use("/api/poses", require("./routes/poseRoutes"));
app.use("/api/breathing", require("./routes/breathingRoutes"));
app.use("/api/routine", require("./routes/routineRoutes"));
app.use("/uploads", express.static("uploads"));
app.use("/api/routine", require("./routes/routineRoutes"));
app.use("/api/pose-tracking", poseTrackingRoutes);

app.get("/", (req, res) => {
  res.send("Yoga Mitra Backend Running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
