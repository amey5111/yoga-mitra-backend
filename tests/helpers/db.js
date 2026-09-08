const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

/**
 * Throwaway Mongo for tests. Nothing touches the real MONGO_URI — each run
 * gets its own in-memory server that is thrown away at the end.
 */
let mem = null;

async function start() {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { serverSelectionTimeoutMS: 10000 });
}

async function clear() {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name].deleteMany({});
  }
}

async function stop() {
  await mongoose.disconnect();
  if (mem) await mem.stop();
  mem = null;
}

module.exports = { start, clear, stop };
