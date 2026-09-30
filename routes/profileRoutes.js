const express = require("express");
const User = require("../models/User");

const router = express.Router();

/* Public instructor profile (name, bio, specialty, photo). */
router.get("/:userId", async (req, res) => {
  try {
    const u = await User.findById(req.params.userId)
      .select("name bio specialty photo role")
      .lean();
    if (!u) return res.status(404).json({ message: "Not found" });
    res.json(u);
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Update own profile. */
router.post("/:userId", async (req, res) => {
  try {
    const { bio, specialty, photo } = req.body || {};
    const set = {};
    if (bio !== undefined) set.bio = bio;
    if (specialty !== undefined) set.specialty = specialty;
    if (photo !== undefined) set.photo = photo;
    const u = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: set },
      { new: true },
    )
      .select("name bio specialty photo")
      .lean();
    if (!u) return res.status(404).json({ message: "Not found" });
    res.json(u);
  } catch (err) {
    res.status(400).json({ message: "Could not save profile" });
  }
});

/* Presence ping — keeps the online-status dot fresh while the app is open. */
router.post("/:userId/heartbeat", async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.params.userId },
      { lastSeenAt: new Date() },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

module.exports = router;
