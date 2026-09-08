const test = require("node:test");
const assert = require("node:assert/strict");

const materials = require("../services/materialService");

/* ── url safety ───────────────────────────────────────────────────────────── */

test("isSafeUrl accepts http, https and our own uploads", () => {
  assert.equal(materials.isSafeUrl("https://youtu.be/abc123"), true);
  assert.equal(materials.isSafeUrl("http://example.com/track.mp3"), true);
  assert.equal(materials.isSafeUrl("/uploads/materials/abc.mp3"), true);
});

test("isSafeUrl rejects schemes that would run on the student's phone", () => {
  assert.equal(materials.isSafeUrl("javascript:alert(1)"), false);
  assert.equal(materials.isSafeUrl("data:text/html;base64,PHNjcmlwdD4="), false);
  assert.equal(materials.isSafeUrl("file:///etc/passwd"), false);
  assert.equal(materials.isSafeUrl("ftp://example.com/x.mp3"), false);
});

test("isSafeUrl rejects empty, oversized and traversing paths", () => {
  assert.equal(materials.isSafeUrl(""), false);
  assert.equal(materials.isSafeUrl(null), false);
  assert.equal(materials.isSafeUrl("not a url"), false);
  assert.equal(materials.isSafeUrl("/uploads/../../../etc/passwd"), false);
  assert.equal(
    materials.isSafeUrl(`https://example.com/${"a".repeat(3000)}`),
    false,
  );
});

/* ── mime mapping ─────────────────────────────────────────────────────────── */

test("kindForMime maps uploads to the right kind", () => {
  assert.equal(materials.kindForMime("audio/mpeg"), "audio");
  assert.equal(materials.kindForMime("video/mp4"), "video");
  assert.equal(materials.kindForMime("image/png"), "image");
  assert.equal(materials.kindForMime("application/pdf"), "pdf");
  assert.equal(materials.kindForMime("text/html"), null);
  assert.equal(materials.kindForMime(""), null);
});

/* ── durations ────────────────────────────────────────────────────────────── */

test("cleanDuration defaults, rounds and caps", () => {
  assert.equal(materials.cleanDuration(undefined), 0);
  assert.equal(materials.cleanDuration(""), 0);
  assert.equal(materials.cleanDuration(90), 90);
  assert.equal(materials.cleanDuration(90.4), 90);
  assert.equal(materials.cleanDuration(999999), 24 * 60 * 60);
  assert.throws(() => materials.cleanDuration(-5), /zero or more/);
  assert.throws(() => materials.cleanDuration("soon"), /zero or more/);
});

/* ── normalizeMaterial ────────────────────────────────────────────────────── */

test("normalizeMaterial accepts a note", () => {
  const out = materials.normalizeMaterial({
    kind: "note",
    title: "Warm up",
    body: "Five rounds of cat-cow.",
  });
  assert.equal(out.kind, "note");
  assert.equal(out.title, "Warm up");
  assert.equal(out.body, "Five rounds of cat-cow.");
  assert.equal(out.publishedToStudents, true);
});

test("normalizeMaterial accepts an instruction with a duration", () => {
  const out = materials.normalizeMaterial({
    kind: "instruction",
    title: "Hold downward dog",
    durationSeconds: 45,
  });
  assert.equal(out.durationSeconds, 45);
});

test("normalizeMaterial accepts media with a url", () => {
  const out = materials.normalizeMaterial({
    kind: "video",
    title: "Full sequence",
    url: "https://youtu.be/abc123",
  });
  assert.equal(out.kind, "video");
  assert.equal(out.url, "https://youtu.be/abc123");
});

test("normalizeMaterial trims whitespace", () => {
  const out = materials.normalizeMaterial({ kind: "note", title: "  Hi  " });
  assert.equal(out.title, "Hi");
});

test("normalizeMaterial rejects an unknown kind", () => {
  assert.throws(
    () => materials.normalizeMaterial({ kind: "hologram", title: "x" }),
    /kind must be one of/,
  );
});

test("normalizeMaterial requires content", () => {
  assert.throws(
    () => materials.normalizeMaterial({ kind: "note" }),
    /needs a title or some text/,
  );
  assert.throws(
    () => materials.normalizeMaterial({ kind: "audio", title: "Track" }),
    /needs a url/,
  );
});

test("normalizeMaterial rejects an unsafe url", () => {
  assert.throws(
    () =>
      materials.normalizeMaterial({
        kind: "link",
        title: "Tap me",
        url: "javascript:alert(1)",
      }),
    /http\(s\) address/,
  );
});

test("normalizeMaterial enforces length limits", () => {
  assert.throws(
    () =>
      materials.normalizeMaterial({
        kind: "note",
        title: "a".repeat(materials.MAX_TITLE + 1),
      }),
    /title must be/,
  );
  assert.throws(
    () =>
      materials.normalizeMaterial({
        kind: "note",
        title: "ok",
        body: "b".repeat(materials.MAX_BODY + 1),
      }),
    /body must be/,
  );
});

test("normalizeMaterial honours publishedToStudents=false", () => {
  const out = materials.normalizeMaterial({
    kind: "note",
    title: "Draft",
    publishedToStudents: false,
  });
  assert.equal(out.publishedToStudents, false);
});

test("a partial update only touches the keys it was given", () => {
  const out = materials.normalizeMaterial({ title: "New title" }, {
    partial: true,
  });
  assert.deepEqual(Object.keys(out), ["title"]);
  assert.equal(out.title, "New title");
});

test("a partial update still validates what it was given", () => {
  assert.throws(
    () => materials.normalizeMaterial({ url: "javascript:x" }, { partial: true }),
    /http\(s\) address/,
  );
  assert.throws(
    () => materials.normalizeMaterial({ kind: "nope" }, { partial: true }),
    /kind must be one of/,
  );
});

/* ── assertHasContent ─────────────────────────────────────────────────────── */

test("assertHasContent judges the merged item", () => {
  assert.throws(
    () => materials.assertHasContent({ kind: "note", title: "", body: "" }),
    /needs a title or some text/,
  );
  assert.doesNotThrow(() =>
    materials.assertHasContent({ kind: "note", title: "", body: "text" }),
  );
  assert.doesNotThrow(() =>
    materials.assertHasContent({ kind: "pdf", url: "/uploads/materials/a.pdf" }),
  );
});

/* ── resolveOrder ─────────────────────────────────────────────────────────── */

test("resolveOrder applies the order the client asked for", () => {
  assert.deepEqual(resolve(["a", "b", "c"], ["c", "a", "b"]), ["c", "a", "b"]);
});

test("resolveOrder puts unmentioned items at the back, keeping their order", () => {
  assert.deepEqual(resolve(["a", "b", "c", "d"], ["c"]), ["c", "a", "b", "d"]);
});

test("resolveOrder rejects unknown and duplicated ids", () => {
  assert.throws(() => resolve(["a", "b"], ["a", "z"]), /unknown material id: z/);
  assert.throws(
    () => resolve(["a", "b"], ["a", "a"]),
    /duplicate material id: a/,
  );
  assert.throws(() => resolve(["a"], "a"), /orderedIds must be an array/);
});

function resolve(existing, ordered) {
  return materials.resolveOrder(existing, ordered);
}

/* ── toClient ─────────────────────────────────────────────────────────────── */

test("toClient fills in every field the app reads", () => {
  const out = materials.toClient({
    _id: "m1",
    classId: "c1",
    instructorId: "t1",
    kind: "audio",
    title: "Breathing track",
    url: "/uploads/materials/a.mp3",
    sizeBytes: 1024,
    createdAt: new Date("2026-09-10T05:00:00Z"),
  });

  assert.equal(out.id, "m1");
  assert.equal(out.kind, "audio");
  assert.equal(out.body, "");
  assert.equal(out.durationSeconds, 0);
  assert.equal(out.publishedToStudents, true);
  assert.equal(out.createdAt, "2026-09-10T05:00:00.000Z");
  assert.equal(out.updatedAt, null);
});
