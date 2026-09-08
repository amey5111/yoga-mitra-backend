const express = require("express");
const LiveClass = require("../models/LiveClass");
const LiveAttendance = require("../models/LiveAttendance");
const LessonMaterial = require("../models/LessonMaterial");
const agora = require("../utils/agoraClient");
const calendar = require("../services/calendarService");

const router = express.Router();

/* The lesson plan for a class (notes, instructions, media) lives in its own
   router. Mounted first so the prefix is matched before the "/:id" routes. */
router.use("/:id/materials", require("./lessonMaterialRoutes"));

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
           scheduledAt?, durationMinutes?, goLiveNow? }
------------------------------------------------------------- */
router.post("/", async (req, res) => {
  try {
    const {
      title,
      description = "",
      instructorId,
      instructorName = "Instructor",
      scheduledAt = null,
      durationMinutes,
      goLiveNow = false,
      visibility = "public",
      stageMode = "webinar",
    } = req.body || {};

    if (!title || !instructorId) {
      return res
        .status(400)
        .json({ message: "title and instructorId are required" });
    }

    // An unparseable date used to reach Mongoose and surface as a 500; reject
    // it here so the client gets a message it can act on.
    let startsAt = null;
    if (scheduledAt) {
      startsAt = calendar.toDate(scheduledAt);
      if (!startsAt) {
        return res.status(400).json({ message: "scheduledAt is not a valid date" });
      }
    }
    if (!goLiveNow && !startsAt) {
      return res
        .status(400)
        .json({ message: "scheduledAt is required unless goLiveNow is true" });
    }

    const liveClass = await LiveClass.create({
      title,
      description,
      instructorId,
      instructorName,
      channelName: makeChannelName(),
      status: goLiveNow ? "live" : "scheduled",
      scheduledAt: goLiveNow ? null : startsAt,
      durationMinutes: calendar.normalizeDuration(durationMinutes),
      startedAt: goLiveNow ? new Date() : null,
      visibility: visibility === "private" ? "private" : "public",
      stageMode: stageMode === "group" ? "group" : "webinar",
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

/* -------------------------------------------------------------
   Calendar: classes inside a date window, bucketed into days of
   the viewer's timezone. Backs the month grid and the day agenda.

   NOTE: must stay above "/:id" — Express matches in order, and
   "/calendar" would otherwise be read as a class id.

   query:
     month=YYYY-MM          | from=<ISO>&to=<ISO>   (default: this month)
     tzOffset=<minutes east of UTC>                 (330 for IST)
     instructorId=<id>      only theirs, private ones included
     viewerId=<id>          flags events as isMine
     status=scheduled,live  comma list                (default: all)
     summary=1              per-day counts only, no event bodies
------------------------------------------------------------- */
router.get("/calendar", async (req, res) => {
  try {
    const { start, end, tzOffsetMinutes } = calendar.parseRange({
      from: req.query.from,
      to: req.query.to,
      month: req.query.month,
      tzOffset: req.query.tzOffset,
    });

    const instructorId = String(req.query.instructorId || "").trim();
    const viewerId = String(req.query.viewerId || instructorId || "").trim();

    const query = {};
    if (instructorId) {
      // An instructor looking at their own schedule sees private classes too.
      query.instructorId = instructorId;
    } else {
      // Browsing the platform schedule: public classes only.
      query.visibility = "public";
    }

    const statuses = String(req.query.status || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowed = ["scheduled", "live", "ended"];
    const unknown = statuses.filter((s) => !allowed.includes(s));
    if (unknown.length) {
      return res
        .status(400)
        .json({ message: `unknown status: ${unknown.join(", ")}` });
    }
    if (statuses.length) query.status = { $in: statuses };

    // A class can start before the window opens and still run into it, so widen
    // the fetch by the longest class we allow and trim precisely in JS after.
    const pad = calendar.MAX_DURATION_MINUTES * calendar.MINUTE_MS;
    const lower = new Date(start.getTime() - pad);
    query.$or = [
      { scheduledAt: { $gte: lower, $lt: end } },
      { scheduledAt: null, startedAt: { $gte: lower, $lt: end } },
      {
        scheduledAt: null,
        startedAt: null,
        createdAt: { $gte: lower, $lt: end },
      },
    ];

    const classes = await LiveClass.find(query)
      .select("-questions -raisedHands -participants -ratings -recording")
      .limit(2000)
      .lean();

    const built = calendar.buildCalendar(classes, {
      start,
      end,
      tzOffsetMinutes,
      viewerId,
    });

    const summary = req.query.summary === "1" || req.query.summary === "true";
    res.json({
      range: {
        from: start.toISOString(),
        to: end.toISOString(),
        tzOffset: tzOffsetMinutes,
      },
      counts: built.counts,
      total: built.total,
      days: summary
        ? built.days.map((d) => ({ date: d.date, count: d.count }))
        : built.days,
      events: summary ? [] : built.events,
    });
  } catch (err) {
    if (err instanceof calendar.CalendarRequestError) {
      return res.status(400).json({ message: err.message });
    }
    console.error("CALENDAR ERROR:", err.message);
    res.status(500).json({ message: "Could not load calendar" });
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
        "status speakers raisedHands questions recording attendeesCount participants hostUid instructorId instructorName stageMode",
      )
      .lean();
    if (!c) return res.status(404).json({ message: "Not found" });
    res.json({
      status: c.status,
      speakers: c.speakers || [],
      raisedHands: c.raisedHands || [],
      questions: c.questions || [],
      participants: c.participants || [],
      // Lets each client label video tiles and pick out the instructor's.
      hostUid: c.hostUid || 0,
      instructorId: c.instructorId || "",
      instructorName: c.instructorName || "Instructor",
      stageMode: c.stageMode || "webinar",
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

    // The room decides the role, not the caller. In a group class everyone is
    // on camera, so every joiner is granted a broadcaster token; in a webinar
    // only the instructor and the students they have brought on stage are.
    const asked = req.query.role === "host" ? "host" : "audience";
    const viewerId = String(req.query.viewerId || "").trim();
    const isInstructor = viewerId && viewerId === String(c.instructorId);
    const isSpeaker = viewerId && (c.speakers || []).includes(viewerId);

    let role = asked;
    if (c.stageMode === "group") {
      role = "host";
    } else if (viewerId && asked === "host" && !isInstructor && !isSpeaker) {
      // Asked to publish in a webinar without being on stage: watch instead.
      role = "audience";
    }

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
      stageMode: c.stageMode || "webinar",
      hostUid: c.hostUid || 0,
      instructorId: c.instructorId || "",
      token,
      tokenConfigured: agora.isTokenConfigured(),
    });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* -------------------------------------------------------------
   Instructor: move a class to another slot (from the calendar).
   body: { scheduledAt?, durationMinutes?, instructorId? }
------------------------------------------------------------- */
router.patch("/:id/schedule", async (req, res) => {
  try {
    const { scheduledAt, durationMinutes, instructorId } = req.body || {};

    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });

    // Only the owner may move a class.
    if (instructorId && String(c.instructorId) !== String(instructorId)) {
      return res.status(403).json({ message: "Not your class" });
    }
    if (c.status !== "scheduled") {
      return res
        .status(409)
        .json({ message: `A ${c.status} class cannot be rescheduled` });
    }

    if (scheduledAt !== undefined) {
      const when = calendar.toDate(scheduledAt);
      if (!when) {
        return res
          .status(400)
          .json({ message: "scheduledAt is not a valid date" });
      }
      c.scheduledAt = when;
    }
    if (durationMinutes !== undefined) {
      c.durationMinutes = calendar.normalizeDuration(durationMinutes);
    }

    await c.save();
    res.json({ liveClass: c });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

/* Instructor: go live. Publishes their Agora uid so viewers know which
   incoming video stream is the instructor's. */
router.post("/:id/go-live", async (req, res) => {
  try {
    const update = { status: "live", startedAt: new Date() };
    const agoraUid = Number(req.body?.agoraUid);
    if (Number.isFinite(agoraUid) && agoraUid > 0) {
      update.hostUid = Math.round(agoraUid);
    }
    const c = await LiveClass.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
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

/* Audience join: track the participant (for the people panel) + count.
   agoraUid maps this person to the video tile their stream renders into. */
router.post("/:id/join", async (req, res) => {
  try {
    const {
      userId = "",
      userName = "Guest",
      onStage = false,
      agoraUid,
    } = req.body || {};
    const c = await LiveClass.findById(req.params.id);
    if (!c) return res.status(404).json({ message: "Not found" });

    const uid = Number(agoraUid);
    const cleanUid = Number.isFinite(uid) && uid > 0 ? Math.round(uid) : 0;

    if (userId) {
      const existing = c.participants.find((p) => p.userId === userId);
      if (existing) {
        // A rejoin (dropped call, app restart) gets a fresh Agora uid; keep the
        // mapping current instead of leaving tiles labelled with a stale name.
        if (cleanUid) existing.agoraUid = cleanUid;
        existing.userName = userName;
      } else {
        c.participants.push({
          userId,
          userName,
          onStage,
          agoraUid: cleanUid,
        });
        c.attendeesCount += 1;
      }
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
    // Keep the people panel in step with who is actually on camera.
    const participant = c.participants.find((p) => p.userId === userId);
    if (participant) participant.onStage = true;
    await c.save();
    res.json({
      speakers: c.speakers,
      raisedHands: c.raisedHands,
      participants: c.participants,
    });
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
    const participant = c.participants.find((p) => p.userId === userId);
    if (participant) participant.onStage = false;
    await c.save();
    res.json({
      speakers: c.speakers,
      raisedHands: c.raisedHands,
      participants: c.participants,
    });
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
    // The lesson plan belongs to the class; do not leave it orphaned.
    await LessonMaterial.deleteMany({ classId: String(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: "Bad id" });
  }
});

module.exports = router;
