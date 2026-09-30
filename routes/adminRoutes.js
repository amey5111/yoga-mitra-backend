const express = require("express");
const User = require("../models/User");
const LiveClass = require("../models/LiveClass");

const router = express.Router();

// An instructor is "online" if seen within this window (heartbeat / login).
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

/* Gate every admin route: the caller must be the admin/recruiter account.
   adminId comes from the query (GET) or body (POST). */
async function requireAdmin(req, res, next) {
  try {
    const adminId = String(
      req.query.adminId || (req.body && req.body.adminId) || "",
    ).trim();
    if (!adminId) return res.status(401).json({ message: "adminId required" });
    const admin = await User.findById(adminId).select("isAdmin").lean();
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ message: "Admin access only" });
    }
    next();
  } catch (err) {
    return res.status(403).json({ message: "Admin access only" });
  }
}

router.use(requireAdmin);

/* Escape a user string before using it in a RegExp. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* -------------------------------------------------------------
   Overview counters for the top of the admin console.
------------------------------------------------------------- */
router.get("/overview", async (_req, res) => {
  try {
    const now = Date.now();
    const [instructors, liveClasses, totalClasses, students] =
      await Promise.all([
        User.find({ role: "instructor" }).select("lastSeenAt").lean(),
        LiveClass.find({ status: "live" }).select("instructorId").lean(),
        LiveClass.countDocuments({}),
        User.countDocuments({ role: "user" }),
      ]);

    const liveInstructorIds = new Set(
      liveClasses.map((c) => String(c.instructorId)),
    );
    let online = 0;
    for (const i of instructors) {
      const seen = i.lastSeenAt ? new Date(i.lastSeenAt).getTime() : 0;
      if (now - seen < ONLINE_WINDOW_MS || liveInstructorIds.has(String(i._id))) {
        online += 1;
      }
    }

    res.json({
      totalInstructors: instructors.length,
      onlineInstructors: online,
      liveClasses: liveClasses.length,
      totalClasses,
      totalStudents: students,
    });
  } catch (err) {
    console.error("ADMIN OVERVIEW ERROR:", err.message);
    res.status(500).json({ message: "Could not load overview" });
  }
});

/* -------------------------------------------------------------
   Every instructor with their live/online status. Search by ?q=.
   Each row carries its live class (if any) so the console can join it.
------------------------------------------------------------- */
router.get("/instructors", async (req, res) => {
  try {
    const now = Date.now();
    const q = String(req.query.q || "").trim();

    const filter = { role: "instructor" };
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ name: rx }, { email: rx }, { specialty: rx }];
    }

    const [instructors, allClasses] = await Promise.all([
      User.find(filter)
        .select("name email specialty photo lastSeenAt isAdmin createdAt")
        .sort({ name: 1 })
        .lean(),
      LiveClass.find({}).lean(),
    ]);

    // Per-instructor: their live class (if any) and total class count.
    const liveByInstructor = new Map();
    const countByInstructor = new Map();
    for (const c of allClasses) {
      const key = String(c.instructorId);
      countByInstructor.set(key, (countByInstructor.get(key) || 0) + 1);
      if (c.status === "live" && !liveByInstructor.has(key)) {
        liveByInstructor.set(key, c);
      }
    }

    const rows = instructors.map((i) => {
      const key = String(i._id);
      const liveClass = liveByInstructor.get(key) || null;
      const seen = i.lastSeenAt ? new Date(i.lastSeenAt).getTime() : 0;
      const online = now - seen < ONLINE_WINDOW_MS || !!liveClass;
      return {
        id: key,
        name: i.name,
        email: i.email,
        specialty: i.specialty || "",
        photo: i.photo || "",
        isAdmin: !!i.isAdmin,
        totalClasses: countByInstructor.get(key) || 0,
        lastSeenAt: i.lastSeenAt || null,
        isLive: !!liveClass,
        online,
        liveClass, // full doc when live, else null — the console joins it directly
      };
    });

    res.json({ instructors: rows, count: rows.length });
  } catch (err) {
    console.error("ADMIN INSTRUCTORS ERROR:", err.message);
    res.status(500).json({ message: "Could not load instructors" });
  }
});

/* -------------------------------------------------------------
   Every class from every instructor (any visibility). ?q= &status=
------------------------------------------------------------- */
router.get("/classes", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();

    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { title: rx },
        { instructorName: rx },
        { joinCode: rx },
      ];
    }

    const classes = await LiveClass.find(filter)
      .select("-questions -raisedHands -ratings -recording")
      .sort({ status: 1, startedAt: -1, scheduledAt: 1, createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ classes, count: classes.length });
  } catch (err) {
    console.error("ADMIN CLASSES ERROR:", err.message);
    res.status(500).json({ message: "Could not load classes" });
  }
});

module.exports = router;
