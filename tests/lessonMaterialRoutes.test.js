const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const request = require("supertest");

const db = require("./helpers/db");
const app = require("../app");
const LiveClass = require("../models/LiveClass");
const LessonMaterial = require("../models/LessonMaterial");

const TEACHER = "teacher-1";
const OTHER = "teacher-2";
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "materials");

let seq = 0;

async function makeClass(overrides = {}) {
  seq += 1;
  return LiveClass.create({
    title: "Morning Flow",
    instructorId: TEACHER,
    instructorName: "Asha",
    channelName: `ym-mat-${seq}`,
    joinCode: `YM-M${seq}`,
    status: "scheduled",
    scheduledAt: new Date("2026-09-10T05:00:00Z"),
    ...overrides,
  });
}

/** Add an item through the API, as the owning instructor. */
async function addItem(classId, body) {
  const res = await request(app)
    .post(`/api/live/${classId}/materials`)
    .send({ instructorId: TEACHER, ...body })
    .expect(201);
  return res.body.material;
}

test.before(async () => {
  await db.start();
});

test.after(async () => {
  await db.stop();
});

test.beforeEach(async () => {
  await db.clear();
});

/* ── creating plan items ──────────────────────────────────────────────────── */

test("an instructor can add a note to a class", async () => {
  const c = await makeClass();

  const item = await addItem(c._id, {
    kind: "note",
    title: "Before we start",
    body: "Keep a blanket and a strap nearby.",
  });

  assert.equal(item.kind, "note");
  assert.equal(item.title, "Before we start");
  assert.equal(item.body, "Keep a blanket and a strap nearby.");
  assert.equal(item.order, 0);
  assert.equal(item.publishedToStudents, true);
  assert.ok(item.id);
});

test("instructions carry a duration", async () => {
  const c = await makeClass();

  const item = await addItem(c._id, {
    kind: "instruction",
    title: "Hold downward dog",
    body: "Breathe evenly, heels reaching down.",
    durationSeconds: 45,
  });

  assert.equal(item.kind, "instruction");
  assert.equal(item.durationSeconds, 45);
});

test("media can be attached by link", async () => {
  const c = await makeClass();

  const video = await addItem(c._id, {
    kind: "video",
    title: "Full sequence walkthrough",
    url: "https://youtu.be/abc123",
  });
  const audio = await addItem(c._id, {
    kind: "audio",
    title: "Guided breathing",
    url: "https://example.com/breathe.mp3",
  });

  assert.equal(video.url, "https://youtu.be/abc123");
  assert.equal(audio.kind, "audio");
});

test("new items go to the end of the plan", async () => {
  const c = await makeClass();

  const first = await addItem(c._id, { kind: "note", title: "One" });
  const second = await addItem(c._id, { kind: "note", title: "Two" });
  const third = await addItem(c._id, { kind: "note", title: "Three" });

  assert.equal(first.order, 0);
  assert.equal(second.order, 1);
  assert.equal(third.order, 2);
});

test("adding to the plan validates the item", async () => {
  const c = await makeClass();
  const post = (body) =>
    request(app)
      .post(`/api/live/${c._id}/materials`)
      .send({ instructorId: TEACHER, ...body });

  await post({ kind: "note" }).expect(400);
  await post({ kind: "hologram", title: "x" }).expect(400);
  await post({ kind: "audio", title: "no url" }).expect(400);

  const unsafe = await post({
    kind: "link",
    title: "Tap",
    url: "javascript:alert(1)",
  }).expect(400);
  assert.match(unsafe.body.message, /http\(s\) address/);
});

test("only the owning instructor can add to a plan", async () => {
  const c = await makeClass();

  await request(app)
    .post(`/api/live/${c._id}/materials`)
    .send({ instructorId: OTHER, kind: "note", title: "Sneaky" })
    .expect(403);

  // No instructorId at all is just as unauthorised.
  await request(app)
    .post(`/api/live/${c._id}/materials`)
    .send({ kind: "note", title: "Anonymous" })
    .expect(403);

  assert.equal(await LessonMaterial.countDocuments(), 0);
});

test("a plan cannot be attached to a class that does not exist", async () => {
  await request(app)
    .post("/api/live/64b7f0000000000000000000/materials")
    .send({ instructorId: TEACHER, kind: "note", title: "x" })
    .expect(404);

  await request(app)
    .post("/api/live/not-an-id/materials")
    .send({ instructorId: TEACHER, kind: "note", title: "x" })
    .expect(400);
});

/* ── reading the plan ─────────────────────────────────────────────────────── */

test("students read the plan in order", async () => {
  const c = await makeClass();
  await addItem(c._id, { kind: "note", title: "One" });
  await addItem(c._id, { kind: "instruction", title: "Two" });
  await addItem(c._id, { kind: "video", title: "Three", url: "https://y.tv/1" });

  const res = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .expect(200);

  assert.equal(res.body.total, 3);
  assert.equal(res.body.isOwner, false);
  assert.equal(res.body.classTitle, "Morning Flow");
  assert.deepEqual(res.body.materials.map((m) => m.title), [
    "One",
    "Two",
    "Three",
  ]);
});

test("students do not see unpublished drafts", async () => {
  const c = await makeClass();
  await addItem(c._id, { kind: "note", title: "Published" });
  await addItem(c._id, {
    kind: "note",
    title: "Draft",
    publishedToStudents: false,
  });

  const student = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .expect(200);
  assert.equal(student.body.total, 1);
  assert.equal(student.body.materials[0].title, "Published");

  const owner = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .query({ instructorId: TEACHER })
    .expect(200);
  assert.equal(owner.body.total, 2);
  assert.equal(owner.body.isOwner, true);
});

test("another instructor sees only what students see", async () => {
  const c = await makeClass();
  await addItem(c._id, {
    kind: "note",
    title: "Draft",
    publishedToStudents: false,
  });

  const res = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .query({ instructorId: OTHER })
    .expect(200);

  assert.equal(res.body.isOwner, false);
  assert.equal(res.body.total, 0);
});

test("a class with no plan reads as an empty plan", async () => {
  const c = await makeClass();
  const res = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .expect(200);

  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.materials, []);
});

/* ── editing ──────────────────────────────────────────────────────────────── */

test("an instructor can edit an item", async () => {
  const c = await makeClass();
  const item = await addItem(c._id, { kind: "note", title: "Draft title" });

  const res = await request(app)
    .patch(`/api/live/${c._id}/materials/${item.id}`)
    .send({ instructorId: TEACHER, title: "Final title", body: "More detail" })
    .expect(200);

  assert.equal(res.body.material.title, "Final title");
  assert.equal(res.body.material.body, "More detail");
  assert.equal(res.body.material.kind, "note");
});

test("editing one field leaves the others alone", async () => {
  const c = await makeClass();
  const item = await addItem(c._id, {
    kind: "instruction",
    title: "Hold the pose",
    body: "Keep breathing",
    durationSeconds: 60,
  });

  const res = await request(app)
    .patch(`/api/live/${c._id}/materials/${item.id}`)
    .send({ instructorId: TEACHER, durationSeconds: 90 })
    .expect(200);

  assert.equal(res.body.material.durationSeconds, 90);
  assert.equal(res.body.material.title, "Hold the pose");
  assert.equal(res.body.material.body, "Keep breathing");
});

test("an edit cannot empty out an item", async () => {
  const c = await makeClass();
  const note = await addItem(c._id, { kind: "note", title: "Something" });

  await request(app)
    .patch(`/api/live/${c._id}/materials/${note.id}`)
    .send({ instructorId: TEACHER, title: "", body: "" })
    .expect(400);

  const video = await addItem(c._id, {
    kind: "video",
    title: "Clip",
    url: "https://y.tv/1",
  });
  await request(app)
    .patch(`/api/live/${c._id}/materials/${video.id}`)
    .send({ instructorId: TEACHER, url: "" })
    .expect(400);
});

test("publishing a draft makes it visible to students", async () => {
  const c = await makeClass();
  const item = await addItem(c._id, {
    kind: "note",
    title: "Draft",
    publishedToStudents: false,
  });

  await request(app)
    .patch(`/api/live/${c._id}/materials/${item.id}`)
    .send({ instructorId: TEACHER, publishedToStudents: true })
    .expect(200);

  const student = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .expect(200);
  assert.equal(student.body.total, 1);
});

test("only the owner can edit or delete an item", async () => {
  const c = await makeClass();
  const item = await addItem(c._id, { kind: "note", title: "Mine" });

  await request(app)
    .patch(`/api/live/${c._id}/materials/${item.id}`)
    .send({ instructorId: OTHER, title: "Hijacked" })
    .expect(403);

  await request(app)
    .delete(`/api/live/${c._id}/materials/${item.id}`)
    .send({ instructorId: OTHER })
    .expect(403);

  const still = await LessonMaterial.findById(item.id).lean();
  assert.equal(still.title, "Mine");
});

test("an item from another class cannot be edited through this one", async () => {
  const mine = await makeClass();
  const theirs = await makeClass({ channelName: "ym-mat-other" });
  const item = await addItem(theirs._id, { kind: "note", title: "Theirs" });

  await request(app)
    .patch(`/api/live/${mine._id}/materials/${item.id}`)
    .send({ instructorId: TEACHER, title: "Moved" })
    .expect(404);
});

test("editing validates the material id", async () => {
  const c = await makeClass();

  await request(app)
    .patch(`/api/live/${c._id}/materials/64b7f0000000000000000000`)
    .send({ instructorId: TEACHER, title: "x" })
    .expect(404);

  await request(app)
    .patch(`/api/live/${c._id}/materials/not-an-id`)
    .send({ instructorId: TEACHER, title: "x" })
    .expect(400);
});

test("an instructor can delete an item", async () => {
  const c = await makeClass();
  const item = await addItem(c._id, { kind: "note", title: "Remove me" });

  await request(app)
    .delete(`/api/live/${c._id}/materials/${item.id}`)
    .send({ instructorId: TEACHER })
    .expect(200);

  assert.equal(await LessonMaterial.countDocuments(), 0);
});

/* ── reordering ───────────────────────────────────────────────────────────── */

test("an instructor can reorder the plan", async () => {
  const c = await makeClass();
  const a = await addItem(c._id, { kind: "note", title: "A" });
  const b = await addItem(c._id, { kind: "note", title: "B" });
  const d = await addItem(c._id, { kind: "note", title: "C" });

  const res = await request(app)
    .post(`/api/live/${c._id}/materials/reorder`)
    .send({ instructorId: TEACHER, orderedIds: [d.id, a.id, b.id] })
    .expect(200);

  assert.deepEqual(res.body.materials.map((m) => m.title), ["C", "A", "B"]);
  assert.deepEqual(res.body.materials.map((m) => m.order), [0, 1, 2]);

  // And it sticks for the next reader.
  const again = await request(app)
    .get(`/api/live/${c._id}/materials`)
    .expect(200);
  assert.deepEqual(again.body.materials.map((m) => m.title), ["C", "A", "B"]);
});

test("reordering rejects unknown ids and non-owners", async () => {
  const c = await makeClass();
  const a = await addItem(c._id, { kind: "note", title: "A" });

  await request(app)
    .post(`/api/live/${c._id}/materials/reorder`)
    .send({ instructorId: TEACHER, orderedIds: [a.id, "64b7f0000000000000000000"] })
    .expect(400);

  await request(app)
    .post(`/api/live/${c._id}/materials/reorder`)
    .send({ instructorId: OTHER, orderedIds: [a.id] })
    .expect(403);
});

/* ── uploads ──────────────────────────────────────────────────────────────── */

test("an instructor can upload an audio file into the plan", async () => {
  const c = await makeClass();

  const res = await request(app)
    .post(`/api/live/${c._id}/materials/upload`)
    .field("instructorId", TEACHER)
    .field("title", "Guided breathing")
    .attach("file", Buffer.from("fake-mp3-bytes"), {
      filename: "breathe.mp3",
      contentType: "audio/mpeg",
    })
    .expect(201);

  const m = res.body.material;
  assert.equal(m.kind, "audio");
  assert.equal(m.title, "Guided breathing");
  assert.equal(m.fileName, "breathe.mp3");
  assert.equal(m.mimeType, "audio/mpeg");
  assert.ok(m.sizeBytes > 0);
  assert.match(m.url, /^\/uploads\/materials\/[0-9a-f]{32}\.mp3$/);

  // The file really is on disk where the URL says it is.
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, path.basename(m.url))));
});

test("the uploaded file is served back over /uploads", async () => {
  const c = await makeClass();
  const res = await request(app)
    .post(`/api/live/${c._id}/materials/upload`)
    .field("instructorId", TEACHER)
    .attach("file", Buffer.from("hello-bytes"), {
      filename: "clip.mp4",
      contentType: "video/mp4",
    })
    .expect(201);

  // Served as video/mp4, so supertest hands it back as a Buffer.
  const fetched = await request(app).get(res.body.material.url).expect(200);
  assert.equal(fetched.headers["content-type"], "video/mp4");
  assert.equal(Buffer.from(fetched.body).toString(), "hello-bytes");
});

test("uploads reject file types we will not play", async () => {
  const c = await makeClass();

  await request(app)
    .post(`/api/live/${c._id}/materials/upload`)
    .field("instructorId", TEACHER)
    .attach("file", Buffer.from("<script>"), {
      filename: "evil.html",
      contentType: "text/html",
    })
    .expect(415);

  assert.equal(await LessonMaterial.countDocuments(), 0);
});

test("a non-owner's upload is refused and leaves nothing behind", async () => {
  const c = await makeClass();
  const before = fs.readdirSync(UPLOAD_DIR).length;

  await request(app)
    .post(`/api/live/${c._id}/materials/upload`)
    .field("instructorId", OTHER)
    .attach("file", Buffer.from("bytes"), {
      filename: "x.mp3",
      contentType: "audio/mpeg",
    })
    .expect(403);

  assert.equal(await LessonMaterial.countDocuments(), 0);
  // The rejected upload did not stay on disk.
  assert.equal(fs.readdirSync(UPLOAD_DIR).length, before);
});

test("deleting an uploaded item removes the file too", async () => {
  const c = await makeClass();
  const res = await request(app)
    .post(`/api/live/${c._id}/materials/upload`)
    .field("instructorId", TEACHER)
    .attach("file", Buffer.from("bytes"), {
      filename: "note.pdf",
      contentType: "application/pdf",
    })
    .expect(201);

  const onDisk = path.join(UPLOAD_DIR, path.basename(res.body.material.url));
  assert.ok(fs.existsSync(onDisk));

  await request(app)
    .delete(`/api/live/${c._id}/materials/${res.body.material.id}`)
    .send({ instructorId: TEACHER })
    .expect(200);

  assert.equal(fs.existsSync(onDisk), false);
});

/* ── lifecycle ────────────────────────────────────────────────────────────── */

test("cancelling a class takes its lesson plan with it", async () => {
  const c = await makeClass();
  await addItem(c._id, { kind: "note", title: "One" });
  await addItem(c._id, { kind: "note", title: "Two" });
  assert.equal(await LessonMaterial.countDocuments(), 2);

  await request(app).delete(`/api/live/${c._id}`).expect(200);

  assert.equal(await LessonMaterial.countDocuments(), 0);
});

test("a plan does not leak between classes", async () => {
  const one = await makeClass();
  const two = await makeClass({ channelName: "ym-mat-two" });
  await addItem(one._id, { kind: "note", title: "For class one" });
  await addItem(two._id, { kind: "note", title: "For class two" });

  const res = await request(app)
    .get(`/api/live/${one._id}/materials`)
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.materials[0].title, "For class one");
});

test("the materials route does not shadow the single class route", async () => {
  const c = await makeClass();
  const res = await request(app).get(`/api/live/${c._id}`).expect(200);
  assert.equal(res.body.liveClass.title, "Morning Flow");
});
