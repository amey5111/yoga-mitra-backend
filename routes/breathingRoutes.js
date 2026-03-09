const express = require("express");
const BreathingTechnique = require("../models/BreathingTechnique");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const items = await BreathingTechnique.find().lean();
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching breathing techniques" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const item = await BreathingTechnique.findOne({
      id: Number(req.params.id),
    }).lean();

    if (!item) {
      return res.status(404).json({ message: "Technique not found" });
    }

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching technique" });
  }
});

module.exports = router;
