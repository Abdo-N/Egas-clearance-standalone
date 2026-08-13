require("dotenv").config();
const { connectDB } = require("../config/db");
const upsertDepartments = require("./upsertDepartments");

async function run() {
  await connectDB();

  console.log("[seed] upserting departments...");
  const departments = await upsertDepartments();

  console.log(`[seed] done. Upserted ${departments.length} departments. No accounts, requests, or evidence were created -- visit the site and it'll prompt to create the first super_admin account (see CLAUDE.md "admin-managed accounts, no AD").`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
