const express = require("express");
const YogaPose = require("../models/YogaPose");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const poses = await YogaPose.find().lean();
    res.json(poses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching poses" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const pose = await YogaPose.findOne({
      id: Number(req.params.id),
    }).lean();

    if (!pose) {
      return res.status(404).json({ message: "Pose not found" });
    }

    res.json(pose);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching pose" });
  }
});

module.exports = router;
