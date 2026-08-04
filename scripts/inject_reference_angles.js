/**
 * inject_reference_angles.js
 *
 * Reads pose_reference_data.json, computes the 8 key joint angles
 * from each pose's normalized XY vector, and writes them back as
 * a "referenceAngles" field on every entry.
 *
 * ML Kit PoseLandmarkType → vector index mapping (each landmark = 2 floats):
 *   0  nose            11 leftShoulder   12 rightShoulder
 *   13 leftElbow       14 rightElbow     15 leftWrist     16 rightWrist
 *   23 leftHip         24 rightHip       25 leftKnee      26 rightKnee
 *   27 leftAnkle       28 rightAnkle
 *
 * The 8 joints (matching AngleScorer._joints order):
 *   0  leftElbow     vertex=13  a=11  b=15
 *   1  rightElbow    vertex=14  a=12  b=16
 *   2  leftKnee      vertex=25  a=23  b=27
 *   3  rightKnee     vertex=26  a=24  b=28
 *   4  leftShoulder  vertex=11  a=23  b=13
 *   5  rightShoulder vertex=12  a=24  b=14
 *   6  leftHip       vertex=23  a=11  b=25
 *   7  rightHip      vertex=24  a=12  b=26
 */

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(
  __dirname,
  '../../AI_Yoga_Mitra_Frontend/assets/data/pose_reference_data.json'
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getXY(vector, landmarkIndex) {
  const i = landmarkIndex * 2;
  return { x: vector[i], y: vector[i + 1] };
}

function angleDeg(a, vertex, b) {
  // Angle at vertex formed by rays vertex→a and vertex→b
  const ax = a.x - vertex.x, ay = a.y - vertex.y;
  const bx = b.x - vertex.x, by = b.y - vertex.y;
  const radians = Math.atan2(by, bx) - Math.atan2(ay, ax);
  let deg = Math.abs(radians * 180 / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

/** The same 8 joints as AngleScorer._joints */
const JOINTS = [
  // [vertexIdx, aIdx, bIdx]
  [13, 11, 15], // 0  leftElbow
  [14, 12, 16], // 1  rightElbow
  [25, 23, 27], // 2  leftKnee
  [26, 24, 28], // 3  rightKnee
  [11, 23, 13], // 4  leftShoulder abduction
  [12, 24, 14], // 5  rightShoulder abduction
  [23, 11, 25], // 6  leftHip flexion
  [24, 12, 26], // 7  rightHip flexion
];

function computeAngles(vector) {
  if (!vector || vector.length < 66) return Array(8).fill(null);
  return JOINTS.map(([v, a, b]) => {
    const vertex = getXY(vector, v);
    const ptA    = getXY(vector, a);
    const ptB    = getXY(vector, b);
    const deg = angleDeg(ptA, vertex, ptB);
    // Round to 2 decimal places to keep JSON compact
    return Math.round(deg * 100) / 100;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const raw = fs.readFileSync(JSON_PATH, 'utf8');
const poses = JSON.parse(raw);

let updated = 0;
for (const pose of poses) {
  pose.referenceAngles = computeAngles(pose.referenceVector);
  updated++;
}

fs.writeFileSync(JSON_PATH, JSON.stringify(poses, null, 2), 'utf8');
console.log(`✅ Injected referenceAngles into ${updated} poses → ${JSON_PATH}`);
