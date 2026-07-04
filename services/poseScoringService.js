function calculatePoseScore(similarity, jointAccuracy) {
  const similarityScore = similarity * 60;

  const accuracyScore = jointAccuracy * 40;

  return Math.round(similarityScore + accuracyScore);
}

module.exports = {
  calculatePoseScore,
};
