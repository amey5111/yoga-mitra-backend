const express = require("express");
const LiveClass = require("../models/LiveClass");
const LiveAttendance = require("../models/LiveAttendance");
const agora = require("../utils/agoraClient");

const router = express.Router();

// Fixed uid used by the cloud-recording bot (must not collide with clients).
const RECORD_UID = 999998;

function makeChannelName() {
  const a = Date.now().toString(36);
  const b = Math.floor(Math.random() * 1e8).toString(36);
  return `ym-${a}-${b}`;
}

function makeJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return `YM-${s}`;
}

/* -------------------------------------------------------------
   Create a class. Instructor can schedule it or go live now.
   body: { title, description, instructorId, instructorName,
           scheduledAt?, goLiveNow? }
------------------------------------------------------------- */
router.post("/", async (req, res) => {
  try {
    const {
      title,
      description = "",
      instructorId,
      instructorName = "Instructor",
      scheduledAt = null,
      goLiveNow = false,
      visibility = "public",
    } = req.body || {};

    if (!title || !instructorId) {
      return res
        .status(400)
        .json({ message: "title and instructorId are required" });
    }

    const liveClass = await LiveClass.create({
      title,
      description,
      instructorId,
      instructorName,
      channelName: makeChannelName(),
      status: goLiveNow ? "live" : "scheduled",
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      startedAt: goLiveNow ? new Date() : null,
      visibility: visibility === "private" ? "private" : "public",
      joinCode: makeJoinCode(),
    });

    res.status(201).json({ liveClass });
  } catch (err) {
    console.error("CREATE LIVE CLASS ERROR:", err.message);
    res.status(500).json({ message: "Could not create class" });
  }
});

/* -------------------------------------------------------------
   Feed for the Live section: { live, upcoming, recorded }
------------------------------------------------------------- */
router.get("/feed", async (_req, res) => {
  try {
    const [live, upcoming, recorded] = await Promise.all([
      LiveClass.find({ status: "live", visibility: "public" })
        .sort({ startedAt: -1 })
        .lean(),
      LiveClass.find({ status: "scheduled", visibility: "public" })
        .sort({ scheduledAt: 1 })
        .lean(),
      LiveClass.find({
        status: "ended",
        visibility: "public",
        recordingUrl: { $ne: "" },
      })
        .sort({ endedAt: -1 })
        .lean(),
    ]);
    res.json({ live, upcoming, recorded });
  } catch (err) {
    console.error("LIVE FEED ERROR:", err.message);
    res.status(500).json({ message: "Could not load classes" });
  }
});

/* Join a private (or any) class by its code. */
router.get("/by-code/:code", async (req, res) => {
  try {
    const c = await LiveClass.findOne({
      joinCode: req.params.code.trim().toUpperCase(),
    }).lean();
    if (!c) return res.status(404).json({ message: "No class with that code" });
    res.json({ liveClass: c });
  } catch (err) {
    res.status(400).json({ message: "Bad code" });
  }
});

/* -------------------------------------------------------------
   Per-instructor stats for the instructor dashboard.
------------------------------------------------------------- */
router.get("/instructor/:instructorId/stats", async (req, res) => {
  try {
    const classes = await LiveClass.find({
      instructorId: req.params.instructorId,
    }).lean();
    let totalMinutes = 0;
    let totalStudents = 0;
    let recordings = 0;
    let sessionsTaken = 0;
    let liveNow = 0;
    let upcoming = 0;
    const uniq = new Set();
    for (const c of classes) {
      if (c.status === "ended") sessionsTaken++;
      else if (c.status === "live") liveNow++;
      else upcoming++;
      if (c.startedAt && c.endedAt) {
        totalMinutes += Math.max(
          0,
          (new Date(c.endedAt) - new Date(c.startedAt)) / 60000,
        );
      }
      totalStudents += c.attendeesCount || 0;
      if (c.recordingUrl) recordings++;
      (c.participants || []).forEach((p) => {
        if (p.userId) uniq.add(p.userId);
      });
    }
    res.json({
      totalClasses: classes.length,
      sessionsTaken,
      liveNow,
      upcoming,
      totalMinutes: Math.round(totalMinutes),
      totalStudents,
      uniqueStudents: uniq.size,
      recordings,
    });
  } catch (err) {
    res.status(500).json({ message: "Could not load stats" });
  }
});

/* List with optional filters: ?status=&instructorId= */
router.get("/", async (req, res) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status;
    if (req.query.instructorId) q.instructorId = req.query.instructorId;
    const classes = await LiveClass.find(q).sort({ createdAt: -1 }).lean();
    res.json({ classes });
  } catch (err) {
    res.status(500).json({ message: "Could not list classes" });
  }
});

/* Single class */
router.get("/:id", async (req, res) => {
  try {
    const liveClass = await LiveClass.findById(req.params.id).lean();
    if (!liveClass) return res.status(404).json({ message: "Not found" });
    res.json({ liveClass });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* -------------------------------------------------------------
   Lightweight poll state (clients poll this every few seconds):
   status, speakers, raisedHands, questions, recording flag.
------------------------------------------------------------- */
router.get("/:id/state", async (req, res) => {
  try {
    const c = await LiveClass.findById(req.params.id)
      .select(
        "status speakers raisedHands questions recording attendeesCount participants",
      )
      .lean();
    if (!c) return res.status(404).json({ message: "Not found" });
    res.json({
      status: c.status,
      speakers: c.speakers || [],
      raisedHands: c.raisedHands || [],
      questions: c.questions || [],
      participants: c.participants || [],
      isRecording: !!(c.recording && c.recording.isRecording),
      attendeesCount: c.attendeesCount || 0,
    });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* -------------------------------------------------------------
   Agora RTC token for joining the channel.
   query: ?uid=<number>&role=host|audience
   Returns { appId, channelName, uid, token }.
------------------------------------------------------------- */
router.get("/:id/token", async (req, res) => {
  try {
    const c = await LiveClass.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ message: "Not found" });

    const uid = Number(req.query.uid || 0);
    const role = req.query.role === "host" ? "host" : "audience";
    let token = "";
    try {
      token = agora.buildRtcToken(c.channelName, uid, role);
    } catch (e) {
      console.log("Token build skipped:", e.message);
    }

    res.json({
      appId: agora.APP_ID,
      channelName: c.channelName,
      uid,
      role,
      token,
      tokenConfigured: agora.isTokenConfigured(),
    });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Instructor: go live */
router.post("/:id/go-live", async (req, res) => {
  try {
    const c = await LiveClass.findByIdAndUpdate(
      req.params.id,
      { status: "live", startedAt: new Date() },
      { new: true },
    );
    if (!c) return res.status(404).json({ message: "Not found" });
    res.json({ liveClass: c });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Instructor: end class (also stops recording if running) */
router.post("/:id/end", async (req, res) => {
  try {
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });

    if (c.recording && c.recording.isRecording) {
      try {
        const result = await agora.stopRecording(
          c.channelName,
          RECORD_UID,
          c.recording.resourceId,
          c.recording.sid,
        );
        const url = extractRecordingUrl(result);
        if (url) c.recordingUrl = url;
      } catch (e) {
        console.log("Stop recording on end failed:", e.message);
      }
      c.recording.isRecording = false;
    }

    c.status = "ended";
    c.endedAt = new Date();
    c.speakers = [];
    await c.save();
    res.json({ liveClass: c });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Audience join: track the participant (for the people panel) + count. */
router.post("/:id/join", async (req, res) => {
  try {
    const { userId = "", userName = "Guest", onStage = false } = req.body || {};
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    if (userId && !c.participants.some((p) => p.userId === userId)) {
      c.participants.push({ userId, userName, onStage });
      c.attendeesCount += 1;
    }
    await c.save();
    res.json({ liveClass: c });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Leave: drop the participant from the room. */
router.post("/:id/leave", async (req, res) => {
  try {
    const { userId = "" } = req.body || {};
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    c.participants = c.participants.filter((p) => p.userId !== userId);
    await c.save();
    res.json({ participants: c.participants });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Record how long a user attended (for their personal history). */
router.post("/:id/attendance", async (req, res) => {
  try {
    const { userId, minutes = 0 } = req.body || {};
    if (!userId) return res.status(400).json({ message: "userId required" });
    const c = await LiveClass.findById(req.params.id).lean();
    await LiveAttendance.create({
      userId,
      classId: req.params.id,
      title: c ? c.title : "Live class",
      instructorName: c ? c.instructorName : "Instructor",
      minutes: Math.max(0, Math.round(minutes)),
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: "Could not save attendance" });
  }
});

/* A user's live-class attendance history (what they joined + time spent). */
router.get("/user/:userId/history", async (req, res) => {
  try {
    const items = await LiveAttendance.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const totalMinutes = items.reduce((s, i) => s + (i.minutes || 0), 0);
    res.json({ items, totalSessions: items.length, totalMinutes });
  } catch (err) {
    res.status(500).json({ message: "Could not load history" });
  }
});

/* -------------------------------------------------------------
   Q&A
------------------------------------------------------------- */
router.post("/:id/questions", async (req, res) => {
  try {
    const { userId = "", userName = "Guest", text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ message: "text is required" });
    }
    const c = await LiveClass.findByIdAndUpdate(
      req.params.id,
      { $push: { questions: { userId, userName, text: text.trim() } } },
      { new: true },
    );
    if (!c) return res.status(404).json({ message: "Not found" });
    res.status(201).json({ questions: c.questions });
  } catch (err) {
    res.status(400).json({ message: "Could not post question" });
  }
});

router.post("/:id/questions/:qid/answer", async (req, res) => {
  try {
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    const q = c.questions.id(req.params.qid);
    if (q) q.answered = true;
    await c.save();
    res.json({ questions: c.questions });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* -------------------------------------------------------------
   Raise hand / role control
------------------------------------------------------------- */
router.post("/:id/raise-hand", async (req, res) => {
  try {
    const { userId, userName = "Guest" } = req.body || {};
    if (!userId) return res.status(400).json({ message: "userId is required" });
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });

    const already = c.raisedHands.find((h) => h.userId === userId);
    if (!already) c.raisedHands.push({ userId, userName });
    await c.save();
    res.json({ raisedHands: c.raisedHands });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Instructor approves a raised hand -> user becomes a speaker (host role) */
router.post("/:id/approve-hand", async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ message: "userId is required" });
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });

    const hand = c.raisedHands.find((h) => h.userId === userId);
    if (hand) hand.approved = true;
    if (!c.speakers.includes(userId)) c.speakers.push(userId);
    await c.save();
    res.json({ speakers: c.speakers, raisedHands: c.raisedHands });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Instructor lowers a hand / removes a speaker -> back to audience */
router.post("/:id/lower-hand", async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ message: "userId is required" });
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });

    c.speakers = c.speakers.filter((s) => s !== userId);
    c.raisedHands = c.raisedHands.filter((h) => h.userId !== userId);
    await c.save();
    res.json({ speakers: c.speakers, raisedHands: c.raisedHands });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* -------------------------------------------------------------
   Cloud recording (external storage, never in the app)
------------------------------------------------------------- */
router.post("/:id/recording/start", async (req, res) => {
  try {
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    if (!agora.isRecordingConfigured()) {
      return res
        .status(400)
        .json({ message: "Cloud recording is not configured on the server" });
    }
    if (c.recording && c.recording.isRecording) {
      return res.json({ message: "Already recording", recording: c.recording });
    }

    const resourceId = await agora.acquireRecording(c.channelName, RECORD_UID);
    const { sid } = await agora.startRecording(
      c.channelName,
      RECORD_UID,
      resourceId,
    );

    c.recording = {
      isRecording: true,
      resourceId,
      sid,
      uid: String(RECORD_UID),
    };
    await c.save();
    res.json({ recording: c.recording });
  } catch (err) {
    console.error("START RECORDING ERROR:", err.response?.data || err.message);
    res.status(500).json({ message: "Could not start recording" });
  }
});

router.post("/:id/recording/stop", async (req, res) => {
  try {
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    if (!c.recording || !c.recording.isRecording) {
      return res.status(400).json({ message: "Not recording" });
    }

    const result = await agora.stopRecording(
      c.channelName,
      RECORD_UID,
      c.recording.resourceId,
      c.recording.sid,
    );
    const url = extractRecordingUrl(result);
    if (url) c.recordingUrl = url;
    c.recording.isRecording = false;
    await c.save();
    res.json({ recordingUrl: c.recordingUrl, raw: result });
  } catch (err) {
    console.error("STOP RECORDING ERROR:", err.response?.data || err.message);
    res.status(500).json({ message: "Could not stop recording" });
  }
});

/* Manually set / override the playable recording URL for a class. */
router.post("/:id/recording/url", async (req, res) => {
  try {
    const { recordingUrl = "" } = req.body || {};
    const c = await LiveClass.findByIdAndUpdate(
      req.params.id,
      { recordingUrl },
      { new: true },
    ).lean();
    if (!c) return res.status(404).json({ message: "Not found" });
    res.json({ liveClass: c });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Build a playable URL from Agora's stop response fileList when possible. */
function extractRecordingUrl(result) {
  try {
    const sr = result && result.serverResponse;
    if (!sr) return "";
    const list = sr.fileList;
    let fileName = "";
    if (Array.isArray(list) && list.length) {
      // Prefer an mp4 if present, else the first file.
      const mp4 = list.find((f) => (f.fileName || "").endsWith(".mp4"));
      fileName = (mp4 || list[0]).fileName || "";
    } else if (typeof list === "string") {
      fileName = list;
    }
    if (!fileName) return "";
    const base = process.env.AGORA_STORAGE_PUBLIC_BASE || "";
    return base ? `${base.replace(/\/$/, "")}/${fileName}` : fileName;
  } catch (_) {
    return "";
  }
}

/* Attendee rates a class (1-5 stars). One rating per user. */
router.post("/:id/rate", async (req, res) => {
  try {
    const { userId = "", stars = 0 } = req.body || {};
    const s = Math.max(1, Math.min(5, Math.round(stars)));
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    const existing = c.ratings.find((r) => r.userId === userId);
    if (existing) existing.stars = s;
    else c.ratings.push({ userId, stars: s });
    await c.save();
    res.json({ ok: true, count: c.ratings.length });
  } catch (err) {
    res.status(400).json({ message: "Could not rate" });
  }
});

/* Cancel / delete a class (instructor). */
router.delete("/:id", async (req, res) => {
  try {
    const c = await LiveClass.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

module.exports = router;
