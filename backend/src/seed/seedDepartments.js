require("dotenv").config();
const { connectDB } = require("../config/db");
const upsertDepartments = require("./upsertDepartments");

async function run() {
  await connectDB();

  console.log("[seed] upserting departments...");
  const departments = await upsertDepartments();

  console.log(`[seed] done. Upserted ${departments.length} departments. No demo accounts or requests were created.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
