const YogaPose = require("../models/YogaPose");
const BreathingTechnique = require("../models/BreathingTechnique");

function safeArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [v];
}

function poseDuration(pose) {
  const base = pose.duration_seconds || 30;
  const reps = pose.repetitions || 1;
  return base * reps;
}

function breathingDuration(item) {
  return item.duration_seconds || 120;
}

function classifyPose(pose) {
  const diff = String(pose.difficulty_level?.en || "").toLowerCase();
  const tags = safeArray(pose.tags).map((t) => t.toLowerCase());

  if (diff.includes("beginner") && tags.includes("stretch")) return "warmup";

  if (
    tags.includes("twist") ||
    tags.includes("spinal health") ||
    tags.includes("flexibility")
  )
    return "mobility";

  if (diff.includes("intermediate") || diff.includes("advanced")) return "main";

  return "cooldown";
}

function buildRoutine(poses, breathing, targetMinutes) {
  const target = targetMinutes * 60;
  const min = target - 300;
  const max = target + 300;

  const warmup = [];
  const mobility = [];
  const main = [];
  const cooldown = [];

  poses.forEach((p) => {
    const type = classifyPose(p);

    if (type === "warmup") warmup.push(p);
    else if (type === "mobility") mobility.push(p);
    else if (type === "main") main.push(p);
    else cooldown.push(p);
  });

  const warmBreath = breathing.slice(0, 1);
  const relaxBreath = breathing.slice(1);

  const sequence = [];

  if (warmBreath[0]) sequence.push({ type: "breathing", item: warmBreath[0] });

  warmup.slice(0, 2).forEach((p) => sequence.push({ type: "pose", item: p }));
  mobility.slice(0, 3).forEach((p) => sequence.push({ type: "pose", item: p }));
  main.slice(0, 3).forEach((p) => sequence.push({ type: "pose", item: p }));
  cooldown.slice(0, 2).forEach((p) => sequence.push({ type: "pose", item: p }));

  if (relaxBreath[0])
    sequence.push({ type: "breathing", item: relaxBreath[0] });

  let total = 0;

  const routine = sequence.map((step, i) => {
    const duration =
      step.type === "pose"
        ? poseDuration(step.item)
        : breathingDuration(step.item);

    total += duration;

    return {
      order: i + 1,
      type: step.type,
      id: step.item.id,
      duration,
    };
  });

  while (total < min && routine.length > 0) {
    for (const step of routine) {
      step.duration += 15;
      total += 15;

      if (total >= min) break;
    }
  }

  return {
    total_duration: total,
    routine,
  };
}

async function generateRoutine(poseIds, breathingIds, duration) {
  const poses = await YogaPose.find({ id: { $in: poseIds } }).lean();
  const breathing = await BreathingTechnique.find({
    id: { $in: breathingIds },
  }).lean();

  return buildRoutine(poses, breathing, duration);
}

module.exports = { generateRoutine };
