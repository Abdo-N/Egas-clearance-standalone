const { Sequelize } = require("sequelize");

// DATABASE_URL replaces the old MONGO_URI -- a standard postgres:// connection
// string, e.g. postgres://user:password@localhost:5432/egas_clearance.
const uri = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/egas_clearance";

const sequelize = new Sequelize(uri, {
  dialect: "postgres",
  logging: false,
});

async function connectDB() {
  await sequelize.authenticate();
  // No separate migrations directory -- this app has no CI pipeline and a
  // single hand-deployed instance (see CLAUDE.md), so syncing model
  // definitions straight to the schema at startup matches the same
  // low-ceremony philosophy Mongoose's implicit collection creation had.
  // `alter: true` brings the schema in line with the models without dropping
  // existing data, which is what a seed-script-driven deployment needs.
  await sequelize.sync({ alter: true });
  // Keep the useful target information without leaking credentials into
  // terminal logs and CI output.
  const safeTarget = uri.replace(/\/\/[^@/]+@/, "//***@").replace(/\?.*$/, "");
  console.log(`[db] connected -> ${safeTarget}`);
}

module.exports = { sequelize, connectDB };
