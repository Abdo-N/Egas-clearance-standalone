const Department = require("../models/Department");
const departments = require("./departments.data");

async function upsertDepartments() {
  await Department.bulkWrite(
    departments.map((department) => ({
      updateOne: {
        filter: { key: department.key },
        update: { $set: department },
        upsert: true,
      },
    }))
  );
  return departments;
}

module.exports = upsertDepartments;
