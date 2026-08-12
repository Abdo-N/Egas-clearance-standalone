const express = require("express");
const Department = require("../models/Department");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Public: static reference data (13 department names/tiers/signature modes),
// not sensitive. Needed both by logged-in dashboards (13-department oversight
// grid) and by the registration form (Register.jsx), which runs before
// anyone has a token yet.
router.get("/", asyncHandler(async (req, res) => {
  const departments = await Department.findAll({
    include: ["checklistItems"],
    order: [["order", "ASC"]],
  });
  res.json(departments);
}));

/**
 * PUBLIC (no auth) -- reports which departments have zero reviewer accounts
 * and, for IT (the only itemized department), which of its 5 checklist
 * items have no assigned reviewer yet. A department/item nobody can sign is
 * a dead end forever (see the tier-locking/itemized rules in CLAUDE.md), so
 * the app isn't really usable until every one of these gaps is closed --
 * this is what lets Register.jsx and Login.jsx warn about that before
 * anyone hits it as a surprise later. Same "public by necessity" reasoning
 * as GET / above and GET /auth/it-contacts: a prospective registrant
 * deciding whether to sign up for a specific gap has no token yet either.
 */
router.get("/coverage", asyncHandler(async (req, res) => {
  const [departments, reviewers] = await Promise.all([
    Department.findAll({ include: ["checklistItems"], order: [["order", "ASC"]] }),
    User.findAll({ where: { role: "reviewer" }, attributes: ["departmentKey", "assignedItemKey"] }),
  ]);

  const reviewersByDept = new Map();
  for (const reviewer of reviewers) {
    const list = reviewersByDept.get(reviewer.departmentKey) || [];
    list.push(reviewer);
    reviewersByDept.set(reviewer.departmentKey, list);
  }

  const missingDepartments = [];
  const missingItems = [];

  for (const dept of departments) {
    const deptReviewers = reviewersByDept.get(dept.key) || [];
    if (dept.signatureMode === "itemized") {
      for (const item of dept.checklistItems) {
        const isAssigned = deptReviewers.some((r) => r.assignedItemKey === item.key);
        if (!isAssigned) {
          missingItems.push({
            departmentKey: dept.key,
            departmentName_ar: dept.name_ar,
            departmentName_en: dept.name_en,
            itemKey: item.key,
            label_ar: item.label_ar,
            label_en: item.label_en,
          });
        }
      }
    } else if (deptReviewers.length === 0) {
      missingDepartments.push({ key: dept.key, name_ar: dept.name_ar, name_en: dept.name_en });
    }
  }

  res.json({
    isFullySetUp: missingDepartments.length === 0 && missingItems.length === 0,
    missingDepartments,
    missingItems,
  });
}));

module.exports = router;
