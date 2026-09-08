const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const LiveClass = require("../models/LiveClass");
const LessonMaterial = require("../models/LessonMaterial");
const materials = require("../services/materialService");

/**
 * The lesson plan for one class: notes, ordered instructions and media.
 *
 * Mounted under /api/live/:id/materials, so `mergeParams` is what gives these
 * handlers access to the class id in req.params.id.
 */
const router = express.Router({ mergeParams: true });

/* Uploaded media lands here and is served by the /uploads static mount. */
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "materials");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      // Never reuse the client's filename on disk: it can carry path segments
      // and collide with someone else's upload.
      const ext = path.extname(file.originalname || "").slice(0, 10);
      const safeExt = /^\.[A-Za-z0-9]{1,9}$/.test(ext) ? ext.toLowerCase() : "";
      cb(null, `${crypto.randomBytes(16).toString("hex")}${safeExt}`);
    },
  }),
  limits: { fileSize: materials.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!materials.ALLOWED_UPLOAD_MIME.includes(file.mimetype)) {
      const err = new Error(`Cannot upload files of type ${file.mimetype}`);
      err.code = "UNSUPPORTED_MEDIA_TYPE";
      return cb(err);
    }
    cb(null, true);
  },
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Load the class this plan belongs to, or answer 404 and return null. */
async function loadClass(req, res) {
  let liveClass;
  try {
    liveClass = await LiveClass.findById(req.params.id)
      .select("instructorId title status")
      .lean();
  } catch (_) {
    res.status(400).json({ message: "Bad id" });
    return null;
  }
  if (!liveClass) {
    res.status(404).json({ message: "Class not found" });
    return null;
  }
  return liveClass;
}

/**
 * Only the instructor who owns the class may change its plan.
 *
 * These routes follow the same convention as the rest of /api/live: the caller
 * states who they are and the server checks it against the class. There is no
 * token check here because this router cannot invent one the rest of the API
 * does not have — see the note in README about adding auth across /api/live.
 */
function ownsClass(liveClass, req) {
  const claimed = String(
    req.body?.instructorId || req.query?.instructorId || "",
  ).trim();
  return !!claimed && claimed === String(liveClass.instructorId);
}

function denyNotOwner(res) {
  return res
    .status(403)
    .json({ message: "Only the class instructor can edit the lesson plan" });
}

function handleError(res, err, fallback) {
  if (err instanceof materials.MaterialRequestError) {
    return res.status(400).json({ message: err.message });
  }
  console.error("LESSON MATERIAL ERROR:", err.message);
  return res.status(500).json({ message: fallback });
}

/** Next order value, so a new item lands at the end of the plan. */
async function nextOrder(classId) {
  const last = await LessonMaterial.findOne({ classId })
    .sort({ order: -1 })
    .select("order")
    .lean();
  return last ? (last.order || 0) + 1 : 0;
}

/* ── read ─────────────────────────────────────────────────────────────────── */

/**
 * The plan for a class.
 *
 * Students see published items only. The owning instructor sees everything,
 * drafts included, by passing their instructorId.
 */
router.get("/", async (req, res) => {
  try {
    const liveClass = await loadClass(req, res);
    if (!liveClass) return;

    const isOwner = ownsClass(liveClass, req);
    const query = { classId: String(req.params.id) };
    if (!isOwner) query.publishedToStudents = true;

    const items = await LessonMaterial.find(query)
      .sort({ order: 1, createdAt: 1 })
      .lean();

    res.json({
      classId: String(req.params.id),
      classTitle: liveClass.title || "",
      isOwner,
      total: items.length,
      materials: items.map(materials.toClient),
    });
  } catch (err) {
    handleError(res, err, "Could not load the lesson plan");
  }
});

/* ── create ───────────────────────────────────────────────────────────────── */

router.post("/", async (req, res) => {
  try {
    const liveClass = await loadClass(req, res);
    if (!liveClass) return;
    if (!ownsClass(liveClass, req)) return denyNotOwner(res);

    const fields = materials.normalizeMaterial(req.body || {});
    const created = await LessonMaterial.create({
      ...fields,
      classId: String(req.params.id),
      instructorId: String(liveClass.instructorId),
      order: fields.order ?? (await nextOrder(String(req.params.id))),
    });

    res.status(201).json({ material: materials.toClient(created) });
  } catch (err) {
    handleError(res, err, "Could not add to the lesson plan");
  }
});

/* ── upload ───────────────────────────────────────────────────────────────── */

/**
 * Upload one audio/video/image/PDF and add it to the plan in a single step.
 *
 * Sent as multipart/form-data: the file under `file`, plus `instructorId` and
 * optional `title`/`body` as form fields.
 */
router.post("/upload", (req, res) => {
  upload.single("file")(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message: `File is too large. The limit is ${Math.round(
            materials.MAX_UPLOAD_BYTES / (1024 * 1024),
          )} MB.`,
        });
      }
      if (uploadErr.code === "UNSUPPORTED_MEDIA_TYPE") {
        return res.status(415).json({ message: uploadErr.message });
      }
      return res.status(400).json({ message: "Upload failed" });
    }

    // Anything that fails from here leaves a file on disk with no row pointing
    // at it, so clean up before answering.
    const discard = () => {
      if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    };

    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file was uploaded" });
      }

      const liveClass = await loadClass(req, res);
      if (!liveClass) return discard();
      if (!ownsClass(liveClass, req)) {
        discard();
        return denyNotOwner(res);
      }

      const kind = materials.kindForMime(req.file.mimetype);
      if (!kind) {
        discard();
        return res
          .status(415)
          .json({ message: `Cannot upload files of type ${req.file.mimetype}` });
      }

      const created = await LessonMaterial.create({
        classId: String(req.params.id),
        instructorId: String(liveClass.instructorId),
        kind,
        title: String(req.body?.title || req.file.originalname || "").slice(
          0,
          materials.MAX_TITLE,
        ),
        body: String(req.body?.body || "").slice(0, materials.MAX_BODY),
        url: `/uploads/materials/${req.file.filename}`,
        fileName: String(req.file.originalname || "").slice(
          0,
          materials.MAX_TITLE,
        ),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        durationSeconds: materials.cleanDuration(req.body?.durationSeconds),
        order: await nextOrder(String(req.params.id)),
        publishedToStudents: req.body?.publishedToStudents !== "false",
      });

      res.status(201).json({ material: materials.toClient(created) });
    } catch (err) {
      discard();
      handleError(res, err, "Could not save the upload");
    }
  });
});

/* ── reorder ──────────────────────────────────────────────────────────────── */

/** Reorder the plan. body: { instructorId, orderedIds: [id, id, ...] } */
router.post("/reorder", async (req, res) => {
  try {
    const liveClass = await loadClass(req, res);
    if (!liveClass) return;
    if (!ownsClass(liveClass, req)) return denyNotOwner(res);

    const existing = await LessonMaterial.find({
      classId: String(req.params.id),
    })
      .sort({ order: 1, createdAt: 1 })
      .select("_id")
      .lean();

    const ordered = materials.resolveOrder(
      existing.map((m) => String(m._id)),
      req.body?.orderedIds,
    );

    await Promise.all(
      ordered.map((id, index) =>
        LessonMaterial.updateOne({ _id: id }, { $set: { order: index } }),
      ),
    );

    const items = await LessonMaterial.find({ classId: String(req.params.id) })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    res.json({ materials: items.map(materials.toClient) });
  } catch (err) {
    handleError(res, err, "Could not reorder the lesson plan");
  }
});

/* ── update / delete ──────────────────────────────────────────────────────── */

router.patch("/:materialId", async (req, res) => {
  try {
    const liveClass = await loadClass(req, res);
    if (!liveClass) return;
    if (!ownsClass(liveClass, req)) return denyNotOwner(res);

    let existing;
    try {
      existing = await LessonMaterial.findById(req.params.materialId);
    } catch (_) {
      return res.status(400).json({ message: "Bad material id" });
    }
    if (!existing || existing.classId !== String(req.params.id)) {
      return res.status(404).json({ message: "Material not found" });
    }

    const fields = materials.normalizeMaterial(req.body || {}, {
      partial: true,
    });
    Object.assign(existing, fields);
    // Judge the merged item, not just the keys that were sent, so an edit
    // cannot empty out a note or strip the url off a video.
    materials.assertHasContent(existing);

    await existing.save();
    res.json({ material: materials.toClient(existing) });
  } catch (err) {
    handleError(res, err, "Could not update the lesson plan");
  }
});

router.delete("/:materialId", async (req, res) => {
  try {
    const liveClass = await loadClass(req, res);
    if (!liveClass) return;
    if (!ownsClass(liveClass, req)) return denyNotOwner(res);

    let existing;
    try {
      existing = await LessonMaterial.findById(req.params.materialId);
    } catch (_) {
      return res.status(400).json({ message: "Bad material id" });
    }
    if (!existing || existing.classId !== String(req.params.id)) {
      return res.status(404).json({ message: "Material not found" });
    }

    const uploadedPath = existing.url.startsWith("/uploads/materials/")
      ? path.join(UPLOAD_DIR, path.basename(existing.url))
      : null;

    await existing.deleteOne();
    // Drop the file too, so deleting a plan does not leave orphans on disk.
    if (uploadedPath) await fs.promises.unlink(uploadedPath).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    handleError(res, err, "Could not remove the item");
  }
});

module.exports = router;
