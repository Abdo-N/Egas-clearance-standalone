const { Department, DepartmentChecklistItem } = require("../models");
const departments = require("./departments.data");

async function upsertDepartments() {
  for (const department of departments) {
    const { checklistItems, ...fields } = department;
    await Department.upsert(fields);
    for (const item of checklistItems) {
      const [row] = await DepartmentChecklistItem.findOrCreate({
        where: { departmentKey: department.key, key: item.key },
        defaults: { label_ar: item.label_ar, label_en: item.label_en },
      });
      await row.update({ label_ar: item.label_ar, label_en: item.label_en });
    }
  }
  return departments;
}

module.exports = upsertDepartments;
