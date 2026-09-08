// The parts of a live class that decide who appears on screen and whose face
// goes with which video tile.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const db = require("./helpers/db");
const app = require("../app");
const LiveClass = require("../models/LiveClass");

const TEACHER = "teacher-1";
let seq = 0;

async function makeClass(overrides = {}) {
  seq += 1;
  return LiveClass.create({
    title: "Morning Flow",
    instructorId: TEACHER,
    instructorName: "Asha",
    channelName: `ym-stage-${seq}`,
    joinCode: `YM-S${seq}`,
    status: "scheduled",
    scheduledAt: new Date("2026-09-10T05:00:00Z"),
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

/* ── host uid ─────────────────────────────────────────────────────────────── */

test("going live records the instructor's Agora uid", async () => {
  const c = await makeClass();

  const res = await request(app)
    .post(`/api/live/${c._id}/go-live`)
    .send({ agoraUid: 4242 })
    .expect(200);

  assert.equal(res.body.liveClass.status, "live");
  assert.equal(res.body.liveClass.hostUid, 4242);
  assert.ok(res.body.liveClass.startedAt);
});

test("state reports the host uid so viewers can find the instructor's video", async () => {
  const c = await makeClass();
  await request(app)
    .post(`/api/live/${c._id}/go-live`)
    .send({ agoraUid: 4242 })
    .expect(200);

  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);

  assert.equal(res.body.hostUid, 4242);
  assert.equal(res.body.instructorId, TEACHER);
  assert.equal(res.body.instructorName, "Asha");
  assert.equal(res.body.status, "live");
});

test("going live without a uid still works and leaves hostUid at zero", async () => {
  const c = await makeClass();

  const res = await request(app)
    .post(`/api/live/${c._id}/go-live`)
    .send({})
    .expect(200);

  assert.equal(res.body.liveClass.status, "live");
  assert.equal(res.body.liveClass.hostUid, 0);
});

test("a nonsense uid is ignored rather than stored", async () => {
  const c = await makeClass();

  for (const agoraUid of ["abc", -5, 0, null]) {
    const res = await request(app)
      .post(`/api/live/${c._id}/go-live`)
      .send({ agoraUid })
      .expect(200);
    assert.equal(res.body.liveClass.hostUid, 0);
  }
});

/* ── participant uids ─────────────────────────────────────────────────────── */

test("joining records the participant's Agora uid", async () => {
  const c = await makeClass({ status: "live" });

  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "student-1", userName: "Ravi", agoraUid: 1001 })
    .expect(200);

  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.equal(res.body.participants.length, 1);
  assert.equal(res.body.participants[0].userName, "Ravi");
  assert.equal(res.body.participants[0].agoraUid, 1001);
  assert.equal(res.body.attendeesCount, 1);
});

test("every participant gets their own tile mapping", async () => {
  const c = await makeClass({ status: "live" });

  for (const [userId, userName, agoraUid] of [
    ["s1", "Ravi", 1001],
    ["s2", "Meera", 1002],
    ["s3", "Dev", 1003],
  ]) {
    await request(app)
      .post(`/api/live/${c._id}/join`)
      .send({ userId, userName, agoraUid })
      .expect(200);
  }

  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  const byUid = Object.fromEntries(
    res.body.participants.map((p) => [p.agoraUid, p.userName]),
  );

  assert.deepEqual(byUid, { 1001: "Ravi", 1002: "Meera", 1003: "Dev" });
  assert.equal(res.body.attendeesCount, 3);
});

test("rejoining refreshes the uid instead of duplicating the person", async () => {
  const c = await makeClass({ status: "live" });
  const join = (agoraUid, userName = "Ravi") =>
    request(app)
      .post(`/api/live/${c._id}/join`)
      .send({ userId: "student-1", userName, agoraUid })
      .expect(200);

  await join(1001);
  await join(2002, "Ravi Kumar"); // reconnected with a new uid

  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.equal(res.body.participants.length, 1);
  assert.equal(res.body.participants[0].agoraUid, 2002);
  assert.equal(res.body.participants[0].userName, "Ravi Kumar");
  // A reconnect is not a second attendee.
  assert.equal(res.body.attendeesCount, 1);
});

test("joining without a uid is still tracked", async () => {
  const c = await makeClass({ status: "live" });

  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "student-1", userName: "Ravi" })
    .expect(200);

  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.equal(res.body.participants[0].agoraUid, 0);
});

test("leaving drops the person from the room", async () => {
  const c = await makeClass({ status: "live" });
  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "student-1", userName: "Ravi", agoraUid: 1001 })
    .expect(200);

  await request(app)
    .post(`/api/live/${c._id}/leave`)
    .send({ userId: "student-1" })
    .expect(200);

  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.equal(res.body.participants.length, 0);
});

/* ── the stage ────────────────────────────────────────────────────────────── */

test("approving a raised hand puts the person on stage", async () => {
  const c = await makeClass({ status: "live" });
  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "student-1", userName: "Ravi", agoraUid: 1001 })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/raise-hand`)
    .send({ userId: "student-1", userName: "Ravi" })
    .expect(200);

  const res = await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({ userId: "student-1" })
    .expect(200);

  assert.deepEqual(res.body.speakers, ["student-1"]);
  assert.equal(res.body.raisedHands[0].approved, true);
  // The people panel has to agree with the video grid.
  assert.equal(res.body.participants[0].onStage, true);

  const state = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.equal(state.body.participants[0].onStage, true);
});

test("lowering a hand takes the person back off stage", async () => {
  const c = await makeClass({ status: "live" });
  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "student-1", userName: "Ravi", agoraUid: 1001 })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/raise-hand`)
    .send({ userId: "student-1" })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({ userId: "student-1" })
    .expect(200);

  const res = await request(app)
    .post(`/api/live/${c._id}/lower-hand`)
    .send({ userId: "student-1" })
    .expect(200);

  assert.deepEqual(res.body.speakers, []);
  assert.deepEqual(res.body.raisedHands, []);
  assert.equal(res.body.participants[0].onStage, false);
});

test("several students can be on stage at once", async () => {
  const c = await makeClass({ status: "live" });
  for (const [userId, userName, agoraUid] of [
    ["s1", "Ravi", 1001],
    ["s2", "Meera", 1002],
    ["s3", "Dev", 1003],
  ]) {
    await request(app)
      .post(`/api/live/${c._id}/join`)
      .send({ userId, userName, agoraUid })
      .expect(200);
    await request(app)
      .post(`/api/live/${c._id}/raise-hand`)
      .send({ userId, userName })
      .expect(200);
  }

  await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({ userId: "s1" })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({ userId: "s3" })
    .expect(200);

  const state = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.deepEqual(state.body.speakers.sort(), ["s1", "s3"]);

  const onStage = state.body.participants
    .filter((p) => p.onStage)
    .map((p) => p.userName)
    .sort();
  assert.deepEqual(onStage, ["Dev", "Ravi"]);
});

test("ending the class clears the stage", async () => {
  const c = await makeClass({ status: "live" });
  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "s1", userName: "Ravi", agoraUid: 1001 })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/raise-hand`)
    .send({ userId: "s1" })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({ userId: "s1" })
    .expect(200);

  const res = await request(app).post(`/api/live/${c._id}/end`).expect(200);

  assert.equal(res.body.liveClass.status, "ended");
  assert.deepEqual(res.body.liveClass.speakers, []);
  assert.ok(res.body.liveClass.endedAt);
});

test("stage actions need a user and a real class", async () => {
  const c = await makeClass({ status: "live" });

  await request(app).post(`/api/live/${c._id}/raise-hand`).send({}).expect(400);
  await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({})
    .expect(400);
  await request(app).post(`/api/live/${c._id}/lower-hand`).send({}).expect(400);

  await request(app)
    .post("/api/live/64b7f0000000000000000000/approve-hand")
    .send({ userId: "s1" })
    .expect(404);
});

/* ── stage mode ───────────────────────────────────────────────────────────── */

test("a class defaults to webinar mode", async () => {
  const res = await request(app)
    .post("/api/live")
    .send({ title: "Talk", instructorId: TEACHER, goLiveNow: true })
    .expect(201);
  assert.equal(res.body.liveClass.stageMode, "webinar");
});

test("a group class puts everyone on camera", async () => {
  const res = await request(app)
    .post("/api/live")
    .send({
      title: "Practice together",
      instructorId: TEACHER,
      goLiveNow: true,
      stageMode: "group",
    })
    .expect(201);
  assert.equal(res.body.liveClass.stageMode, "group");

  // A plain student asking to watch is still granted a publishing role.
  const token = await request(app)
    .get(`/api/live/${res.body.liveClass._id}/token`)
    .query({ uid: 1001, role: "audience", viewerId: "student-1" })
    .expect(200);

  assert.equal(token.body.role, "host");
  assert.equal(token.body.stageMode, "group");
});

test("an unknown stage mode falls back to webinar", async () => {
  const res = await request(app)
    .post("/api/live")
    .send({
      title: "Odd",
      instructorId: TEACHER,
      goLiveNow: true,
      stageMode: "freeforall",
    })
    .expect(201);
  assert.equal(res.body.liveClass.stageMode, "webinar");
});

test("in a webinar a student cannot talk their way into publishing", async () => {
  const c = await makeClass({ status: "live", stageMode: "webinar" });

  const sneaky = await request(app)
    .get(`/api/live/${c._id}/token`)
    .query({ uid: 1001, role: "host", viewerId: "student-1" })
    .expect(200);
  assert.equal(sneaky.body.role, "audience");

  // The instructor of the class does get a broadcaster token.
  const host = await request(app)
    .get(`/api/live/${c._id}/token`)
    .query({ uid: 4242, role: "host", viewerId: TEACHER })
    .expect(200);
  assert.equal(host.body.role, "host");
});

test("a student brought on stage is granted a publishing role", async () => {
  const c = await makeClass({ status: "live", stageMode: "webinar" });
  await request(app)
    .post(`/api/live/${c._id}/join`)
    .send({ userId: "student-1", userName: "Ravi", agoraUid: 1001 })
    .expect(200);
  await request(app)
    .post(`/api/live/${c._id}/raise-hand`)
    .send({ userId: "student-1" })
    .expect(200);

  const before = await request(app)
    .get(`/api/live/${c._id}/token`)
    .query({ uid: 1001, role: "host", viewerId: "student-1" })
    .expect(200);
  assert.equal(before.body.role, "audience");

  await request(app)
    .post(`/api/live/${c._id}/approve-hand`)
    .send({ userId: "student-1" })
    .expect(200);

  const after = await request(app)
    .get(`/api/live/${c._id}/token`)
    .query({ uid: 1001, role: "host", viewerId: "student-1" })
    .expect(200);
  assert.equal(after.body.role, "host");
});

test("state reports the stage mode so clients know how to join", async () => {
  const c = await makeClass({ status: "live", stageMode: "group" });
  const res = await request(app).get(`/api/live/${c._id}/state`).expect(200);
  assert.equal(res.body.stageMode, "group");
});
