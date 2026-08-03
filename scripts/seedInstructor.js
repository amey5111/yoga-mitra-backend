/*
  Seed / update the default instructor account.
  Run once:  node scripts/seedInstructor.js
  Credentials: instructor@yogamitra.in / instructor
*/
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const EMAIL = "instructor@yogamitra.in";
const PASSWORD = "instructor";
const NAME = "Yoga Instructor";

(async () => {
  const uri =
    process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;
  if (!uri) {
    console.error("No Mongo connection string found in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const doc = await User.findOneAndUpdate(
    { email: EMAIL },
    {
      $set: {
        name: NAME,
        password: hashed,
        role: "instructor",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(
    `Seeded instructor -> email=${doc.email} role=${doc.role} id=${doc._id}`,
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error("Seed error:", e.message);
  process.exit(1);
});
