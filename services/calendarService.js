/**
 * Calendar logic for scheduled classes.
 *
 * Everything here is pure (no Mongo, no Express) so it can be unit tested on
 * its own. The route layer fetches documents and hands them to these helpers.
 *
 * Timezone model
 * --------------
 * Instants are stored in UTC. A calendar grid, though, is drawn in the
 * *viewer's* wall clock: a 00:30 IST class belongs to the Indian day, not to
 * the UTC day before it. Clients therefore send `tzOffset`, their minutes east
 * of UTC (Dart: `DateTime.now().timeZoneOffset.inMinutes`, +330 for IST), and
 * every day boundary here is computed against that offset.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const DEFAULT_DURATION_MINUTES = 60;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 480; // 8h — also the overlap padding for queries

/** Widest window a single calendar request may ask for. */
const MAX_RANGE_DAYS = 400;

/** Offsets range from -12:00 to +14:00 in the real world. */
const MIN_TZ_OFFSET = -12 * 60;
const MAX_TZ_OFFSET = 14 * 60;

class CalendarRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "CalendarRequestError";
    this.statusCode = 400;
  }
}

/* ── small helpers ────────────────────────────────────────────────────────── */

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Parse an ISO string / Date / epoch into a Date, or null if unusable. */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return isValidDate(d) ? d : null;
}

function parseTzOffset(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new CalendarRequestError("tzOffset must be a number of minutes");
  }
  const rounded = Math.round(n);
  if (rounded < MIN_TZ_OFFSET || rounded > MAX_TZ_OFFSET) {
    throw new CalendarRequestError(
      `tzOffset must be between ${MIN_TZ_OFFSET} and ${MAX_TZ_OFFSET} minutes`,
    );
  }
  return rounded;
}

/** Clamp any incoming duration to something a class could plausibly be. */
function normalizeDuration(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MINUTES;
  return Math.min(
    MAX_DURATION_MINUTES,
    Math.max(MIN_DURATION_MINUTES, Math.round(n)),
  );
}

/** "2026-09-08" for the day this instant falls on in the viewer's timezone. */
function dayKey(date, tzOffsetMinutes = 0) {
  const shifted = new Date(date.getTime() + tzOffsetMinutes * MINUTE_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** UTC instant at which the viewer's local day `YYYY-MM-DD` begins. */
function startOfLocalDay(dayString, tzOffsetMinutes = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayString).trim());
  if (!m) throw new CalendarRequestError("date must look like YYYY-MM-DD");
  const [, y, mo, d] = m;
  const utcMidnight = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const asDate = new Date(utcMidnight);
  // Date.UTC happily rolls 2026-02-31 over into March; reject that instead.
  if (
    asDate.getUTCFullYear() !== Number(y) ||
    asDate.getUTCMonth() !== Number(mo) - 1 ||
    asDate.getUTCDate() !== Number(d)
  ) {
    throw new CalendarRequestError(`${dayString} is not a real date`);
  }
  return new Date(utcMidnight - tzOffsetMinutes * MINUTE_MS);
}

/** Every "YYYY-MM-DD" the range touches, in viewer-local days. */
function listDayKeys(start, end, tzOffsetMinutes = 0) {
  const keys = [];
  if (end <= start) return keys;
  let cursor = startOfLocalDay(dayKey(start, tzOffsetMinutes), tzOffsetMinutes);
  while (cursor < end) {
    keys.push(dayKey(cursor, tzOffsetMinutes));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return keys;
}

/* ── range parsing ────────────────────────────────────────────────────────── */

/**
 * Resolve the window a request is asking for.
 *
 * Accepts either `month` ("2026-09"), or `from`/`to` ISO instants, or nothing
 * at all (defaults to the viewer's current month). `to` is exclusive.
 */
function parseRange({ from, to, month, tzOffset } = {}) {
  const tzOffsetMinutes = parseTzOffset(tzOffset);

  let start;
  let end;

  if (month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
    if (!m) throw new CalendarRequestError("month must look like YYYY-MM");
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      throw new CalendarRequestError("month must be between 01 and 12");
    }
    start = new Date(
      Date.UTC(year, monthIndex, 1) - tzOffsetMinutes * MINUTE_MS,
    );
    end = new Date(
      Date.UTC(year, monthIndex + 1, 1) - tzOffsetMinutes * MINUTE_MS,
    );
  } else if (from || to) {
    start = toDate(from);
    end = toDate(to);
    if (from && !start) {
      throw new CalendarRequestError("from is not a valid date");
    }
    if (to && !end) throw new CalendarRequestError("to is not a valid date");
    // One side given: assume a 31-day window from/until it.
    if (!start) start = new Date(end.getTime() - 31 * DAY_MS);
    if (!end) end = new Date(start.getTime() + 31 * DAY_MS);
  } else {
    const now = new Date();
    const local = new Date(now.getTime() + tzOffsetMinutes * MINUTE_MS);
    start = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) -
        tzOffsetMinutes * MINUTE_MS,
    );
    end = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) -
        tzOffsetMinutes * MINUTE_MS,
    );
  }

  if (end <= start) {
    throw new CalendarRequestError("to must be after from");
  }
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new CalendarRequestError(
      `range must be ${MAX_RANGE_DAYS} days or less`,
    );
  }

  return { start, end, tzOffsetMinutes };
}

/* ── event shaping ────────────────────────────────────────────────────────── */

/**
 * When a class actually sits on the calendar.
 *
 * Scheduled classes use `scheduledAt`. A class started with "go live now" has
 * no `scheduledAt`, so it falls back to when it started, and finally to when it
 * was created — that way nothing is invisible on the grid.
 */
function effectiveStart(cls) {
  return (
    toDate(cls.scheduledAt) || toDate(cls.startedAt) || toDate(cls.createdAt)
  );
}

/** When it finishes: the real end for a finished class, else start + duration. */
function effectiveEnd(cls, start) {
  const from = start || effectiveStart(cls);
  if (!from) return null;
  const ended = toDate(cls.endedAt);
  if (ended && ended > from) return ended;
  return new Date(
    from.getTime() + normalizeDuration(cls.durationMinutes) * MINUTE_MS,
  );
}

/** Flatten a LiveClass document into the shape the calendar UI consumes. */
function normalizeEvent(cls, { viewerId = "" } = {}) {
  const start = effectiveStart(cls);
  if (!start) return null;
  const end = effectiveEnd(cls, start);
  const instructorId = String(cls.instructorId || "");

  return {
    id: String(cls._id || cls.id || ""),
    title: cls.title || "Class",
    description: cls.description || "",
    instructorId,
    instructorName: cls.instructorName || "Instructor",
    status: cls.status || "scheduled",
    visibility: cls.visibility || "public",
    joinCode: cls.joinCode || "",
    channelName: cls.channelName || "",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationMinutes: Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / MINUTE_MS),
    ),
    // True when the time came from scheduledAt rather than a fallback — the UI
    // uses this to avoid promising a start time the instructor never set.
    isScheduled: !!toDate(cls.scheduledAt),
    attendeesCount: cls.attendeesCount || 0,
    recordingUrl: cls.recordingUrl || "",
    isMine: !!viewerId && instructorId === String(viewerId),
  };
}

/** Does this event overlap [start, end)? */
function overlapsRange(event, start, end) {
  const s = new Date(event.startAt).getTime();
  const e = new Date(event.endAt).getTime();
  return e > start.getTime() && s < end.getTime();
}

/**
 * Turn documents into the calendar payload: a flat sorted list, per-day
 * buckets for every day in the range, and a counts map for month-grid dots.
 */
function buildCalendar(
  classes,
  { start, end, tzOffsetMinutes = 0, viewerId = "" },
) {
  const events = (classes || [])
    .map((c) => normalizeEvent(c, { viewerId }))
    .filter((e) => e && overlapsRange(e, start, end))
    .sort((a, b) => {
      const d = new Date(a.startAt) - new Date(b.startAt);
      return d !== 0 ? d : a.title.localeCompare(b.title);
    });

  const buckets = new Map();
  for (const key of listDayKeys(start, end, tzOffsetMinutes)) {
    buckets.set(key, []);
  }
  for (const event of events) {
    // An event is filed under the day it starts on. If it started before the
    // window opened, it shows on the first day of the window instead.
    let key = dayKey(new Date(event.startAt), tzOffsetMinutes);
    if (!buckets.has(key)) {
      const firstKey = buckets.keys().next().value;
      if (firstKey === undefined) continue;
      key = firstKey;
    }
    buckets.get(key).push(event);
  }

  const days = [];
  const counts = {};
  for (const [date, dayEvents] of buckets) {
    days.push({ date, count: dayEvents.length, events: dayEvents });
    if (dayEvents.length > 0) counts[date] = dayEvents.length;
  }

  return { events, days, counts, total: events.length };
}

module.exports = {
  CalendarRequestError,
  DEFAULT_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MAX_RANGE_DAYS,
  MINUTE_MS,
  DAY_MS,
  toDate,
  isValidDate,
  parseTzOffset,
  normalizeDuration,
  dayKey,
  startOfLocalDay,
  listDayKeys,
  parseRange,
  effectiveStart,
  effectiveEnd,
  normalizeEvent,
  overlapsRange,
  buildCalendar,
};
