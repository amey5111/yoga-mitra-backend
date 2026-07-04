const PoseSession = require("../models/PoseSession");

exports.saveSession = async (req, res) => {
  try {
    const session = await PoseSession.create(req.body);

    res.status(201).json(session);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to save session",
    });
  }
};

exports.getUserSessions = async (req, res) => {
  try {
    const sessions = await PoseSession.find({
      userId: req.params.userId,
    }).sort({
      createdAt: -1,
    });

    res.json(sessions);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch sessions",
    });
  }
};
