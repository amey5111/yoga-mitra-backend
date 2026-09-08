const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const db = require("./helpers/db");
const app = require("../app");
const LiveClass = require("../models/LiveClass");

const IST = 330;
const TEACHER = "teacher-1";
const OTHER = "teacher-2";

let channelSeq = 0;

/** Insert a class straight into Mongo, bypassing the create route. */
async function seed(overrides = {}) {
  channelSeq += 1;
  return LiveClass.create({
    title: "Class",
    instructorId: TEACHER,
    instructorName: "Asha",
    channelName: `ym-test-${channelSeq}`,
    status: "scheduled",
    visibility: "public",
    durationMinutes: 60,
    joinCode: `YM-T${channelSeq}`,
    ...overrides,
  });
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

/* ── GET /api/live/calendar ───────────────────────────────────────────────── */

test("calendar returns a month of days with events bucketed by local date", async () => {
  await seed({ title: "Morning Flow", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({ title: "Late Night", scheduledAt: new Date("2026-09-09T19:00:00Z") });
  await seed({ title: "Next Month", scheduledAt: new Date("2026-10-10T05:00:00Z") });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST })
    .expect(200);

  assert.equal(res.body.total, 2);
  assert.equal(res.body.days.length, 30);
  assert.equal(res.body.range.tzOffset, IST);
  assert.equal(res.body.range.from, "2026-08-31T18:30:00.000Z");

  // 19:00Z on the 9th is 00:30 IST on the 10th — both classes sit on the 10th.
  assert.deepEqual(res.body.counts, { "2026-09-10": 2 });
  const tenth = res.body.days.find((d) => d.date === "2026-09-10");
  assert.deepEqual(tenth.events.map((e) => e.title), ["Late Night", "Morning Flow"]);
});

test("calendar buckets differently for a different timezone", async () => {
  await seed({ scheduledAt: new Date("2026-09-09T19:00:00Z") });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: 0 })
    .expect(200);

  assert.deepEqual(res.body.counts, { "2026-09-09": 1 });
});

test("calendar defaults to the current month when no window is given", async () => {
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  await seed({ scheduledAt: soon });

  const res = await request(app).get("/api/live/calendar").expect(200);

  const from = new Date(res.body.range.from).getTime();
  const to = new Date(res.body.range.to).getTime();
  assert.ok(from <= Date.now() && Date.now() < to);
});

test("calendar accepts an explicit from/to window", async () => {
  await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({ scheduledAt: new Date("2026-09-20T05:00:00Z") });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ from: "2026-09-09T00:00:00Z", to: "2026-09-12T00:00:00Z", tzOffset: 0 })
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.days.length, 3);
});

test("browsing the platform calendar hides private classes", async () => {
  await seed({ title: "Public", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({
    title: "Private",
    visibility: "private",
    scheduledAt: new Date("2026-09-10T07:00:00Z"),
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST })
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.events[0].title, "Public");
});

test("an instructor's own calendar includes their private classes", async () => {
  await seed({ title: "Public", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({
    title: "Private",
    visibility: "private",
    scheduledAt: new Date("2026-09-10T07:00:00Z"),
  });
  await seed({
    title: "Someone else's",
    instructorId: OTHER,
    scheduledAt: new Date("2026-09-10T09:00:00Z"),
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, instructorId: TEACHER })
    .expect(200);

  assert.equal(res.body.total, 2);
  assert.ok(res.body.events.every((e) => e.isMine === true));
  assert.deepEqual(res.body.events.map((e) => e.title), ["Public", "Private"]);
});

test("viewerId flags only the viewer's own classes as mine", async () => {
  await seed({ title: "Mine", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({
    title: "Theirs",
    instructorId: OTHER,
    scheduledAt: new Date("2026-09-10T07:00:00Z"),
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, viewerId: TEACHER })
    .expect(200);

  const byTitle = Object.fromEntries(res.body.events.map((e) => [e.title, e.isMine]));
  assert.deepEqual(byTitle, { Mine: true, Theirs: false });
});

test("calendar shows a go-live-now class at the time it started", async () => {
  await seed({
    title: "Spontaneous",
    status: "live",
    scheduledAt: null,
    startedAt: new Date("2026-09-10T05:00:00Z"),
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST })
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.events[0].startAt, "2026-09-10T05:00:00.000Z");
  assert.equal(res.body.events[0].isScheduled, false);
});

test("a finished class is drawn to its real end time", async () => {
  await seed({
    title: "Done",
    status: "ended",
    scheduledAt: new Date("2026-09-10T05:00:00Z"),
    startedAt: new Date("2026-09-10T05:02:00Z"),
    endedAt: new Date("2026-09-10T06:45:00Z"),
    durationMinutes: 60,
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST })
    .expect(200);

  assert.equal(res.body.events[0].endAt, "2026-09-10T06:45:00.000Z");
  assert.equal(res.body.events[0].durationMinutes, 105);
});

test("calendar filters by status", async () => {
  await seed({ title: "Upcoming", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({
    title: "Finished",
    status: "ended",
    scheduledAt: new Date("2026-09-11T05:00:00Z"),
    endedAt: new Date("2026-09-11T06:00:00Z"),
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, status: "scheduled" })
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.events[0].title, "Upcoming");
});

test("calendar accepts a comma separated status list", async () => {
  await seed({ title: "Upcoming", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({
    title: "Running",
    status: "live",
    scheduledAt: new Date("2026-09-11T05:00:00Z"),
  });
  await seed({
    title: "Finished",
    status: "ended",
    scheduledAt: new Date("2026-09-12T05:00:00Z"),
    endedAt: new Date("2026-09-12T06:00:00Z"),
  });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, status: "scheduled,live" })
    .expect(200);

  assert.equal(res.body.total, 2);
});

test("summary=1 returns counts without event bodies", async () => {
  await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, summary: "1" })
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.deepEqual(res.body.events, []);
  assert.deepEqual(res.body.counts, { "2026-09-10": 1 });
  assert.ok(res.body.days.every((d) => d.events === undefined));
});

test("an empty month still returns the full day grid", async () => {
  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-11", tzOffset: IST })
    .expect(200);

  assert.equal(res.body.total, 0);
  assert.equal(res.body.days.length, 30);
  assert.deepEqual(res.body.counts, {});
});

test("calendar rejects bad windows and unknown statuses with 400", async () => {
  await request(app).get("/api/live/calendar").query({ month: "2026-9" }).expect(400);
  await request(app).get("/api/live/calendar").query({ month: "2026-13" }).expect(400);
  await request(app).get("/api/live/calendar").query({ from: "nope" }).expect(400);
  await request(app)
    .get("/api/live/calendar")
    .query({ from: "2026-09-10T00:00:00Z", to: "2026-09-01T00:00:00Z" })
    .expect(400);
  await request(app)
    .get("/api/live/calendar")
    .query({ from: "2020-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" })
    .expect(400);
  await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: "9999" })
    .expect(400);

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", status: "pending" })
    .expect(400);
  assert.match(res.body.message, /unknown status/);
});

test("/calendar is not swallowed by the /:id route", async () => {
  // "/:id" sits below it and would answer 400 Bad id if ordering ever changed.
  const res = await request(app).get("/api/live/calendar").expect(200);
  assert.ok(Array.isArray(res.body.days));
});

/* ── POST /api/live ───────────────────────────────────────────────────────── */

test("creating a scheduled class stores the time and duration", async () => {
  const res = await request(app)
    .post("/api/live")
    .send({
      title: "Evening Stretch",
      instructorId: TEACHER,
      instructorName: "Asha",
      scheduledAt: "2026-09-10T05:00:00Z",
      durationMinutes: 45,
    })
    .expect(201);

  assert.equal(res.body.liveClass.status, "scheduled");
  assert.equal(res.body.liveClass.durationMinutes, 45);
  assert.equal(
    new Date(res.body.liveClass.scheduledAt).toISOString(),
    "2026-09-10T05:00:00.000Z",
  );
  assert.ok(res.body.liveClass.joinCode);
});

test("a created class appears on the calendar straight away", async () => {
  await request(app)
    .post("/api/live")
    .send({
      title: "Sunrise Salutation",
      instructorId: TEACHER,
      scheduledAt: "2026-09-10T05:00:00Z",
      durationMinutes: 30,
    })
    .expect(201);

  const res = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, instructorId: TEACHER })
    .expect(200);

  assert.equal(res.body.total, 1);
  assert.equal(res.body.events[0].title, "Sunrise Salutation");
  assert.equal(res.body.events[0].durationMinutes, 30);
});

test("going live now needs no scheduled time", async () => {
  const res = await request(app)
    .post("/api/live")
    .send({ title: "Right now", instructorId: TEACHER, goLiveNow: true })
    .expect(201);

  assert.equal(res.body.liveClass.status, "live");
  assert.equal(res.body.liveClass.scheduledAt, null);
  assert.ok(res.body.liveClass.startedAt);
});

test("an out-of-range duration is clamped rather than rejected", async () => {
  const res = await request(app)
    .post("/api/live")
    .send({
      title: "Marathon",
      instructorId: TEACHER,
      scheduledAt: "2026-09-10T05:00:00Z",
      durationMinutes: 10000,
    })
    .expect(201);

  assert.equal(res.body.liveClass.durationMinutes, 480);
});

test("creating a class rejects bad input with 400 rather than 500", async () => {
  await request(app).post("/api/live").send({ instructorId: TEACHER }).expect(400);
  await request(app).post("/api/live").send({ title: "No teacher" }).expect(400);

  const badDate = await request(app)
    .post("/api/live")
    .send({ title: "Bad", instructorId: TEACHER, scheduledAt: "not a date" })
    .expect(400);
  assert.match(badDate.body.message, /not a valid date/);

  const noTime = await request(app)
    .post("/api/live")
    .send({ title: "Scheduled for never", instructorId: TEACHER })
    .expect(400);
  assert.match(noTime.body.message, /scheduledAt is required/);
});

/* ── PATCH /api/live/:id/schedule ─────────────────────────────────────────── */

test("an instructor can move their class to another slot", async () => {
  const c = await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });

  const res = await request(app)
    .patch(`/api/live/${c._id}/schedule`)
    .send({
      scheduledAt: "2026-09-12T09:30:00Z",
      durationMinutes: 75,
      instructorId: TEACHER,
    })
    .expect(200);

  assert.equal(
    new Date(res.body.liveClass.scheduledAt).toISOString(),
    "2026-09-12T09:30:00.000Z",
  );
  assert.equal(res.body.liveClass.durationMinutes, 75);

  const cal = await request(app)
    .get("/api/live/calendar")
    .query({ month: "2026-09", tzOffset: IST, instructorId: TEACHER })
    .expect(200);
  assert.deepEqual(cal.body.counts, { "2026-09-12": 1 });
});

test("rescheduling can change only the duration", async () => {
  const c = await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });

  const res = await request(app)
    .patch(`/api/live/${c._id}/schedule`)
    .send({ durationMinutes: 90 })
    .expect(200);

  assert.equal(res.body.liveClass.durationMinutes, 90);
  assert.equal(
    new Date(res.body.liveClass.scheduledAt).toISOString(),
    "2026-09-10T05:00:00.000Z",
  );
});

test("someone else's class cannot be moved", async () => {
  const c = await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });

  await request(app)
    .patch(`/api/live/${c._id}/schedule`)
    .send({ scheduledAt: "2026-09-12T09:30:00Z", instructorId: OTHER })
    .expect(403);

  const after = await LiveClass.findById(c._id).lean();
  assert.equal(after.scheduledAt.toISOString(), "2026-09-10T05:00:00.000Z");
});

test("a live or finished class cannot be rescheduled", async () => {
  const live = await seed({ status: "live", startedAt: new Date() });
  await request(app)
    .patch(`/api/live/${live._id}/schedule`)
    .send({ scheduledAt: "2026-09-12T09:30:00Z" })
    .expect(409);

  const ended = await seed({ status: "ended", endedAt: new Date() });
  await request(app)
    .patch(`/api/live/${ended._id}/schedule`)
    .send({ scheduledAt: "2026-09-12T09:30:00Z" })
    .expect(409);
});

test("rescheduling validates the new time and the class id", async () => {
  const c = await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });

  await request(app)
    .patch(`/api/live/${c._id}/schedule`)
    .send({ scheduledAt: "whenever" })
    .expect(400);

  await request(app)
    .patch("/api/live/64b7f0000000000000000000/schedule")
    .send({ scheduledAt: "2026-09-12T09:30:00Z" })
    .expect(404);

  await request(app)
    .patch("/api/live/not-an-id/schedule")
    .send({ scheduledAt: "2026-09-12T09:30:00Z" })
    .expect(400);
});

/* ── existing endpoints still behave ──────────────────────────────────────── */

test("the live feed still splits classes into live, upcoming and recorded", async () => {
  await seed({ title: "Upcoming", scheduledAt: new Date("2026-09-10T05:00:00Z") });
  await seed({ title: "Running", status: "live", startedAt: new Date() });
  await seed({
    title: "Replay",
    status: "ended",
    endedAt: new Date(),
    recordingUrl: "https://example.com/r.mp4",
  });

  const res = await request(app).get("/api/live/feed").expect(200);

  assert.equal(res.body.live.length, 1);
  assert.equal(res.body.upcoming.length, 1);
  assert.equal(res.body.recorded.length, 1);
});

test("a class can still be fetched by id and by join code", async () => {
  const c = await seed({ scheduledAt: new Date("2026-09-10T05:00:00Z") });

  const byId = await request(app).get(`/api/live/${c._id}`).expect(200);
  assert.equal(byId.body.liveClass.title, "Class");

  const byCode = await request(app)
    .get(`/api/live/by-code/${c.joinCode}`)
    .expect(200);
  assert.equal(String(byCode.body.liveClass._id), String(c._id));
});
