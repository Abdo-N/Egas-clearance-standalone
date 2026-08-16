require("dotenv").config();
const { connectDB } = require("../config/db");
const upsertDepartments = require("./upsertDepartments");
const { User } = require("../models");

// Opt-in only -- plain `npm run seed:final` must stay safe to rerun against a
// real deployment (see CLAUDE.md "Commands"), so wiping every account is
// gated behind an explicit flag rather than happening unconditionally. This
// is for local/dev use, to force the in-browser first-run setup flow
// (GET /auth/setup-status) back up by emptying the users table -- NOT
// something to run against a real deployment with live accounts.
const RESET_USERS = process.argv.includes("--reset-users");

async function run() {
  await connectDB();

  if (RESET_USERS) {
    // Counted separately -- `destroy({ truncate: true })` returns 0 under
    // Postgres (TRUNCATE doesn't report an affected-row count the way DELETE
    // does), so logging its return value directly would misreport "deleted
    // 0 accounts" even when every account was in fact wiped.
    const count = await User.count();
    await User.destroy({ where: {}, truncate: true });
    console.log(`[seed] --reset-users: deleted all user accounts (${count}). The next visit to the site will trigger first-run setup again.`);
  }

  console.log("[seed] upserting departments...");
  const departments = await upsertDepartments();

  console.log(`[seed] done. Upserted ${departments.length} departments. ${RESET_USERS ? "All accounts were deleted (--reset-users)" : "No accounts, requests, or evidence were created"} -- visit the site and it'll prompt to create the first super_admin account (see CLAUDE.md "admin-managed accounts, no AD").`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
