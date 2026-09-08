const test = require("node:test");
const assert = require("node:assert/strict");

const calendar = require("../services/calendarService");

const IST = 330; // minutes east of UTC
const NYC = -300; // UTC-5

/* ── dayKey ───────────────────────────────────────────────────────────────── */

test("dayKey files an instant under the viewer's local day", () => {
  const instant = new Date("2026-09-07T19:00:00Z"); // 00:30 IST on the 8th
  assert.equal(calendar.dayKey(instant, IST), "2026-09-08");
  assert.equal(calendar.dayKey(instant, 0), "2026-09-07");
  assert.equal(calendar.dayKey(instant, NYC), "2026-09-07");
});

test("dayKey pads months and days to two digits", () => {
  assert.equal(calendar.dayKey(new Date("2026-01-05T12:00:00Z"), 0), "2026-01-05");
});

/* ── startOfLocalDay ──────────────────────────────────────────────────────── */

test("startOfLocalDay returns the UTC instant the local day begins", () => {
  assert.equal(
    calendar.startOfLocalDay("2026-09-08", IST).toISOString(),
    "2026-09-07T18:30:00.000Z",
  );
  assert.equal(
    calendar.startOfLocalDay("2026-09-08", 0).toISOString(),
    "2026-09-08T00:00:00.000Z",
  );
});

test("startOfLocalDay rejects malformed and impossible dates", () => {
  assert.throws(() => calendar.startOfLocalDay("08-09-2026"), /YYYY-MM-DD/);
  assert.throws(() => calendar.startOfLocalDay("2026-02-31"), /not a real date/);
  assert.throws(() => calendar.startOfLocalDay("2026-13-01"), /not a real date/);
});

/* ── listDayKeys ──────────────────────────────────────────────────────────── */

test("listDayKeys walks every local day the range touches", () => {
  const { start, end } = calendar.parseRange({ month: "2026-09", tzOffset: IST });
  const keys = calendar.listDayKeys(start, end, IST);
  assert.equal(keys.length, 30);
  assert.equal(keys[0], "2026-09-01");
  assert.equal(keys[29], "2026-09-30");
});

test("listDayKeys handles a leap February", () => {
  const { start, end } = calendar.parseRange({ month: "2028-02", tzOffset: 0 });
  assert.equal(calendar.listDayKeys(start, end, 0).length, 29);
});

test("listDayKeys returns nothing for an empty range", () => {
  const d = new Date("2026-09-08T00:00:00Z");
  assert.deepEqual(calendar.listDayKeys(d, d, 0), []);
});

/* ── parseRange ───────────────────────────────────────────────────────────── */

test("parseRange spans a whole month in the viewer's timezone", () => {
  const { start, end, tzOffsetMinutes } = calendar.parseRange({
    month: "2026-09",
    tzOffset: IST,
  });
  assert.equal(start.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(end.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(tzOffsetMinutes, IST);
});

test("parseRange accepts explicit from/to", () => {
  const { start, end } = calendar.parseRange({
    from: "2026-09-01T00:00:00Z",
    to: "2026-09-08T00:00:00Z",
  });
  assert.equal(start.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-08T00:00:00.000Z");
});

test("parseRange fills in the missing side of a one-sided window", () => {
  const fromOnly = calendar.parseRange({ from: "2026-09-01T00:00:00Z" });
  assert.equal(fromOnly.end.toISOString(), "2026-10-02T00:00:00.000Z");

  const toOnly = calendar.parseRange({ to: "2026-10-02T00:00:00Z" });
  assert.equal(toOnly.start.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("parseRange defaults to the current month for the viewer", () => {
  const { start, end } = calendar.parseRange({ tzOffset: IST });
  const now = Date.now();
  assert.ok(start.getTime() <= now && now < end.getTime());
});

test("parseRange rejects bad input", () => {
  assert.throws(() => calendar.parseRange({ month: "2026-9" }), /YYYY-MM/);
  assert.throws(() => calendar.parseRange({ month: "2026-13" }), /between 01 and 12/);
  assert.throws(
    () => calendar.parseRange({ from: "not-a-date" }),
    /from is not a valid date/,
  );
  assert.throws(
    () => calendar.parseRange({ from: "2026-09-08T00:00:00Z", to: "2026-09-01T00:00:00Z" }),
    /to must be after from/,
  );
  assert.throws(
    () => calendar.parseRange({ from: "2020-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }),
    /400 days or less/,
  );
});

test("parseTzOffset validates the offset", () => {
  assert.equal(calendar.parseTzOffset(undefined), 0);
  assert.equal(calendar.parseTzOffset("330"), 330);
  assert.equal(calendar.parseTzOffset(-300), -300);
  assert.throws(() => calendar.parseTzOffset("abc"), /number of minutes/);
  assert.throws(() => calendar.parseTzOffset(2000), /between/);
  assert.throws(() => calendar.parseTzOffset(-1000), /between/);
});

/* ── durations ────────────────────────────────────────────────────────────── */

test("normalizeDuration defaults, clamps and rounds", () => {
  assert.equal(calendar.normalizeDuration(undefined), 60);
  assert.equal(calendar.normalizeDuration(null), 60);
  assert.equal(calendar.normalizeDuration("abc"), 60);
  assert.equal(calendar.normalizeDuration(0), 60);
  assert.equal(calendar.normalizeDuration(-30), 60);
  assert.equal(calendar.normalizeDuration(1), 5); // below the floor
  assert.equal(calendar.normalizeDuration(45), 45);
  assert.equal(calendar.normalizeDuration(44.6), 45);
  assert.equal(calendar.normalizeDuration(10000), 480); // above the ceiling
});

/* ── event shaping ────────────────────────────────────────────────────────── */

test("effectiveStart prefers scheduledAt, then startedAt, then createdAt", () => {
  const scheduled = new Date("2026-09-10T05:00:00Z");
  const started = new Date("2026-09-10T06:00:00Z");
  const created = new Date("2026-09-09T00:00:00Z");

  assert.equal(
    calendar.effectiveStart({ scheduledAt: scheduled, startedAt: started, createdAt: created }).toISOString(),
    scheduled.toISOString(),
  );
  assert.equal(
    calendar.effectiveStart({ scheduledAt: null, startedAt: started, createdAt: created }).toISOString(),
    started.toISOString(),
  );
  assert.equal(
    calendar.effectiveStart({ scheduledAt: null, startedAt: null, createdAt: created }).toISOString(),
    created.toISOString(),
  );
  assert.equal(calendar.effectiveStart({}), null);
});

test("effectiveEnd uses the real end for a finished class", () => {
  const start = new Date("2026-09-10T05:00:00Z");
  const end = calendar.effectiveEnd({
    scheduledAt: start,
    endedAt: new Date("2026-09-10T06:30:00Z"),
    durationMinutes: 60,
  });
  assert.equal(end.toISOString(), "2026-09-10T06:30:00.000Z");
});

test("effectiveEnd falls back to start + duration", () => {
  const start = new Date("2026-09-10T05:00:00Z");
  assert.equal(
    calendar.effectiveEnd({ scheduledAt: start, durationMinutes: 90 }).toISOString(),
    "2026-09-10T06:30:00.000Z",
  );
  // No duration stored -> the 60 minute default.
  assert.equal(
    calendar.effectiveEnd({ scheduledAt: start }).toISOString(),
    "2026-09-10T06:00:00.000Z",
  );
});

test("effectiveEnd ignores an endedAt that precedes the start", () => {
  const start = new Date("2026-09-10T05:00:00Z");
  const end = calendar.effectiveEnd({
    scheduledAt: start,
    endedAt: new Date("2026-09-09T05:00:00Z"),
    durationMinutes: 30,
  });
  assert.equal(end.toISOString(), "2026-09-10T05:30:00.000Z");
});

test("normalizeEvent flattens a class into the calendar shape", () => {
  const event = calendar.normalizeEvent(
    {
      _id: "abc123",
      title: "Morning Flow",
      description: "Gentle start",
      instructorId: "teacher-1",
      instructorName: "Asha",
      status: "scheduled",
      visibility: "private",
      joinCode: "YM-AB12C",
      channelName: "ym-x",
      scheduledAt: new Date("2026-09-10T05:00:00Z"),
      durationMinutes: 45,
      attendeesCount: 3,
    },
    { viewerId: "teacher-1" },
  );

  assert.equal(event.id, "abc123");
  assert.equal(event.title, "Morning Flow");
  assert.equal(event.startAt, "2026-09-10T05:00:00.000Z");
  assert.equal(event.endAt, "2026-09-10T05:45:00.000Z");
  assert.equal(event.durationMinutes, 45);
  assert.equal(event.isScheduled, true);
  assert.equal(event.isMine, true);
  assert.equal(event.visibility, "private");
  assert.equal(event.attendeesCount, 3);
});

test("normalizeEvent marks a fallback time as not scheduled and not mine", () => {
  const event = calendar.normalizeEvent(
    {
      _id: "x",
      instructorId: "teacher-1",
      status: "live",
      startedAt: new Date("2026-09-10T05:00:00Z"),
    },
    { viewerId: "student-9" },
  );
  assert.equal(event.isScheduled, false);
  assert.equal(event.isMine, false);
  assert.equal(event.title, "Class");
  assert.equal(event.instructorName, "Instructor");
});

test("normalizeEvent returns null when a class has no usable time", () => {
  assert.equal(calendar.normalizeEvent({ _id: "x", title: "t" }), null);
});

/* ── buildCalendar ────────────────────────────────────────────────────────── */

function cls(overrides) {
  return {
    _id: overrides.title,
    title: "Class",
    instructorId: "teacher-1",
    status: "scheduled",
    visibility: "public",
    durationMinutes: 60,
    ...overrides,
  };
}

test("buildCalendar buckets events into local days and counts them", () => {
  const { start, end } = calendar.parseRange({ month: "2026-09", tzOffset: IST });
  const built = calendar.buildCalendar(
    [
      cls({ title: "A", scheduledAt: new Date("2026-09-09T19:00:00Z") }), // 10th IST
      cls({ title: "B", scheduledAt: new Date("2026-09-10T05:00:00Z") }), // 10th IST
      cls({ title: "C", scheduledAt: new Date("2026-09-15T05:00:00Z") }),
    ],
    { start, end, tzOffsetMinutes: IST },
  );

  assert.equal(built.total, 3);
  assert.equal(built.days.length, 30);
  assert.deepEqual(built.counts, { "2026-09-10": 2, "2026-09-15": 1 });

  const tenth = built.days.find((d) => d.date === "2026-09-10");
  assert.equal(tenth.count, 2);
  // A is 00:30 IST, B is 10:30 IST — both land on the 10th, in start order.
  assert.deepEqual(tenth.events.map((e) => e.title), ["A", "B"]);
});

test("buildCalendar sorts events by start time", () => {
  const { start, end } = calendar.parseRange({ month: "2026-09", tzOffset: 0 });
  const built = calendar.buildCalendar(
    [
      cls({ title: "late", scheduledAt: new Date("2026-09-10T18:00:00Z") }),
      cls({ title: "early", scheduledAt: new Date("2026-09-10T06:00:00Z") }),
      cls({ title: "mid", scheduledAt: new Date("2026-09-10T12:00:00Z") }),
    ],
    { start, end, tzOffsetMinutes: 0 },
  );
  assert.deepEqual(
    built.events.map((e) => e.startAt),
    [
      "2026-09-10T06:00:00.000Z",
      "2026-09-10T12:00:00.000Z",
      "2026-09-10T18:00:00.000Z",
    ],
  );
});

test("buildCalendar drops events outside the window", () => {
  const { start, end } = calendar.parseRange({ month: "2026-09", tzOffset: 0 });
  const built = calendar.buildCalendar(
    [
      cls({ title: "before", scheduledAt: new Date("2026-08-01T06:00:00Z") }),
      cls({ title: "inside", scheduledAt: new Date("2026-09-10T06:00:00Z") }),
      cls({ title: "after", scheduledAt: new Date("2026-10-05T06:00:00Z") }),
    ],
    { start, end, tzOffsetMinutes: 0 },
  );
  assert.equal(built.total, 1);
  assert.equal(built.events[0].startAt, "2026-09-10T06:00:00.000Z");
});

test("buildCalendar keeps a class that starts before the window but runs into it", () => {
  const { start, end } = calendar.parseRange({
    from: "2026-09-10T06:00:00Z",
    to: "2026-09-11T06:00:00Z",
  });
  const built = calendar.buildCalendar(
    [cls({ title: "spans", scheduledAt: new Date("2026-09-10T05:30:00Z"), durationMinutes: 120 })],
    { start, end, tzOffsetMinutes: 0 },
  );
  assert.equal(built.total, 1);
  // It began before the window, so it is pinned to the first day shown.
  assert.equal(built.days[0].count, 1);
});

test("buildCalendar treats the range end as exclusive", () => {
  const { start, end } = calendar.parseRange({
    from: "2026-09-10T00:00:00Z",
    to: "2026-09-11T00:00:00Z",
  });
  const built = calendar.buildCalendar(
    [cls({ title: "boundary", scheduledAt: new Date("2026-09-11T00:00:00Z") })],
    { start, end, tzOffsetMinutes: 0 },
  );
  assert.equal(built.total, 0);
});

test("buildCalendar copes with an empty list", () => {
  const { start, end } = calendar.parseRange({ month: "2026-09", tzOffset: 0 });
  const built = calendar.buildCalendar([], { start, end, tzOffsetMinutes: 0 });
  assert.equal(built.total, 0);
  assert.equal(built.days.length, 30);
  assert.deepEqual(built.counts, {});
  assert.ok(built.days.every((d) => d.count === 0));
});

test("buildCalendar skips classes with no usable time instead of throwing", () => {
  const { start, end } = calendar.parseRange({ month: "2026-09", tzOffset: 0 });
  const built = calendar.buildCalendar(
    [
      { _id: "broken", title: "no dates", instructorId: "t" },
      cls({ title: "ok", scheduledAt: new Date("2026-09-10T06:00:00Z") }),
    ],
    { start, end, tzOffsetMinutes: 0 },
  );
  assert.equal(built.total, 1);
});
