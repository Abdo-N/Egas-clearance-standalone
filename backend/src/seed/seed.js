require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const connectDB = require("../config/db");
const Department = require("../models/Department");
const User = require("../models/User");
const ClearanceRequest = require("../models/ClearanceRequest");
const departments = require("./departments.data");
const upsertDepartments = require("./upsertDepartments");
const { DEMO_PASSWORD, demoUsers } = require("./demo-users.data");

const UPLOAD_ROOT = path.resolve(__dirname, "../../uploads");
const DUMMY_SIGNATURES_DIR = path.resolve(__dirname, "../../../frontend/src/assets");
const DUMMY_SIGNATURE_FILES = [
  "dummy-signature-1.jpg",
  "dummy-signature-2.jpg",
  "dummy-signature-3.pdf",
  "dummy-signature-4.png",
  "dummy-signature-5.pdf",
  "dummy-signature-6.pdf",
];
const MIME_TYPES_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

const DEMO_REQUEST_IDS = {
  completed: new mongoose.Types.ObjectId("66b100000000000000000001"),
  awaitingIt: new mongoose.Types.ObjectId("66b100000000000000000002"),
};

function demoReviewerForDepartment(departmentKey) {
  return demoUsers.find((user) => user.departmentKey === departmentKey);
}

function demoItReviewerForItem(itemKey) {
  return demoUsers.find(
    (user) => user.departmentKey === "it" && user.assignedItemKey === itemKey
  );
}

function copyDummySignature(requestId, targetKey, signatureIndex) {
  const sourceName = DUMMY_SIGNATURE_FILES[signatureIndex % DUMMY_SIGNATURE_FILES.length];
  const extension = path.extname(sourceName).toLowerCase();
  const safeTargetKey = targetKey.replace(/[^a-z0-9_-]/gi, "-");
  const filename = `${safeTargetKey}-${sourceName}`;
  const destinationDirectory = path.join(UPLOAD_ROOT, String(requestId));

  fs.mkdirSync(destinationDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(DUMMY_SIGNATURES_DIR, sourceName),
    path.join(destinationDirectory, filename)
  );

  return {
    fileUrl: `${requestId}/${filename}`,
    mimeType: MIME_TYPES_BY_EXT[extension],
    originalName: sourceName,
  };
}

function buildSignedDepartments(allDepartments, requestId, signedAtBase) {
  let signatureIndex = 0;

  return allDepartments.map((department) => {
    if (department.signatureMode === "itemized") {
      const items = department.checklistItems.map((item) => {
        const reviewer = demoItReviewerForItem(item.key);
        if (!reviewer) throw new Error(`No demo IT reviewer configured for '${item.key}'`);

        const signedAt = new Date(signedAtBase.getTime() + signatureIndex * 60_000);
        const evidence = copyDummySignature(
          requestId,
          `${department.key}-${item.key}`,
          signatureIndex
        );
        signatureIndex += 1;

        return {
          key: item.key,
          label_ar: item.label_ar,
          label_en: item.label_en,
          assignedItemKey: item.key,
          status: "completed",
          signedByUserID: reviewer.userID,
          signedByFullName: reviewer.fullName,
          signedAt,
          evidence,
        };
      });

      return {
        departmentKey: department.key,
        name_ar: department.name_ar,
        name_en: department.name_en,
        order: department.order,
        tier: department.tier,
        hasOversightDashboard: department.hasOversightDashboard,
        signatureMode: department.signatureMode,
        status: "completed",
        items,
      };
    }

    const reviewer = demoReviewerForDepartment(department.key);
    if (!reviewer) throw new Error(`No demo reviewer configured for '${department.key}'`);

    const signedAt = new Date(signedAtBase.getTime() + signatureIndex * 60_000);
    const evidence = copyDummySignature(requestId, department.key, signatureIndex);
    signatureIndex += 1;

    return {
      departmentKey: department.key,
      name_ar: department.name_ar,
      name_en: department.name_en,
      order: department.order,
      tier: department.tier,
      hasOversightDashboard: department.hasOversightDashboard,
      signatureMode: department.signatureMode,
      status: "completed",
      signedByUserID: reviewer.userID,
      signedByFullName: reviewer.fullName,
      signedAt,
      evidence,
      items: [],
    };
  });
}

async function upsertDemoUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await User.bulkWrite(
    demoUsers.map(({ password, ...user }) => ({
      updateOne: {
        filter: { userID: user.userID },
        update: { $set: { ...user, passwordHash } },
        upsert: true,
      },
    }))
  );
}

async function verifyDemoSeed() {
  const [seededUsers, completedRequest, awaitingItRequest] = await Promise.all([
    User.find({ userID: { $in: demoUsers.map((user) => user.userID) } }),
    ClearanceRequest.findById(DEMO_REQUEST_IDS.completed),
    ClearanceRequest.findById(DEMO_REQUEST_IDS.awaitingIt),
  ]);

  if (seededUsers.length !== demoUsers.length) {
    throw new Error(`Expected ${demoUsers.length} demo users, found ${seededUsers.length}`);
  }
  if (!(await Promise.all(seededUsers.map((user) => bcrypt.compare(DEMO_PASSWORD, user.passwordHash)))).every(Boolean)) {
    throw new Error("At least one demo account does not use the documented demo password");
  }

  for (const request of [completedRequest, awaitingItRequest]) {
    if (!request) throw new Error("A demo request was not created");
    if (request.departments.length !== departments.length) {
      throw new Error(`${request.employeeNumber} does not contain all departments`);
    }
    if (!request.departments.every((department) => department.status === "completed")) {
      throw new Error(`${request.employeeNumber} is missing a department signature`);
    }

    const evidence = request.departments.flatMap((department) =>
      department.signatureMode === "itemized"
        ? department.items.map((item) => item.evidence)
        : [department.evidence]
    );
    if (evidence.some((item) => !item || !fs.existsSync(path.join(UPLOAD_ROOT, item.fileUrl)))) {
      throw new Error(`${request.employeeNumber} is missing a seeded evidence file`);
    }
  }

  if (
    completedRequest.status !== "completed" ||
    !completedRequest.fileManagementApproved ||
    !completedRequest.accessRevoked ||
    !completedRequest.completedAt
  ) {
    throw new Error("DEMO-1001 is not in the fully completed state");
  }
  if (
    awaitingItRequest.status !== "in_progress" ||
    !awaitingItRequest.fileManagementApproved ||
    awaitingItRequest.accessRevoked ||
    awaitingItRequest.completedAt
  ) {
    throw new Error("DEMO-1002 is not in the awaiting-IT state");
  }
}

async function run() {
  await connectDB();

  console.log(`[seed] upserting ${departments.length} departments...`);
  await upsertDepartments();

  console.log(`[seed] upserting ${demoUsers.length} demo accounts...`);
  await upsertDemoUsers();

  console.log("[seed] replacing the two demo clearance requests...");
  const allDepartments = await Department.find({
    key: { $in: departments.map((department) => department.key) },
  }).sort({ order: 1 });
  if (allDepartments.length !== departments.length) {
    throw new Error(`Expected ${departments.length} departments, found ${allDepartments.length}`);
  }

  for (const requestId of Object.values(DEMO_REQUEST_IDS)) {
    fs.rmSync(path.join(UPLOAD_ROOT, String(requestId)), { recursive: true, force: true });
  }

  const submittedAt = new Date("2026-07-15T08:00:00.000Z");
  const signedAtBase = new Date("2026-07-16T08:00:00.000Z");
  const approvedAt = new Date("2026-07-16T12:00:00.000Z");
  const completedAt = new Date("2026-07-16T12:30:00.000Z");
  const fileManager = demoUsers.find((user) => user.role === "file_management");
  const itReviewer = demoItReviewerForItem("sap_account_removal");

  await ClearanceRequest.deleteMany({ _id: { $in: Object.values(DEMO_REQUEST_IDS) } });
  await ClearanceRequest.insertMany([
    {
      _id: DEMO_REQUEST_IDS.completed,
      employeeNumber: "DEMO-1001",
      employeeFullName: "Ahmed Hassan (Completed Demo)",
      employeeJobTitle: "Senior Accountant",
      employeeDepartment_ar: "الإدارة المالية",
      employeeDepartment_en: "Financial Affairs",
      reason: "retirement",
      lastWorkingDay: new Date("2026-07-31T00:00:00.000Z"),
      createdByUserID: fileManager.userID,
      status: "completed",
      departments: buildSignedDepartments(
        allDepartments,
        DEMO_REQUEST_IDS.completed,
        signedAtBase
      ),
      fileManagementApproved: true,
      fileManagementApprovedAt: approvedAt,
      fileManagementApprovedByUserID: fileManager.userID,
      accessRevoked: true,
      accessRevokedAt: completedAt,
      accessRevokedByUserID: itReviewer.userID,
      completedAt,
      createdAt: submittedAt,
      updatedAt: completedAt,
    },
    {
      _id: DEMO_REQUEST_IDS.awaitingIt,
      employeeNumber: "DEMO-1002",
      employeeFullName: "Mona Ibrahim (Awaiting IT Demo)",
      employeeJobTitle: "Contracts Specialist",
      employeeDepartment_ar: "الشئون القانونية",
      employeeDepartment_en: "Legal Affairs",
      reason: "resignation",
      lastWorkingDay: new Date("2026-08-31T00:00:00.000Z"),
      createdByUserID: fileManager.userID,
      status: "in_progress",
      departments: buildSignedDepartments(
        allDepartments,
        DEMO_REQUEST_IDS.awaitingIt,
        new Date(signedAtBase.getTime() + 24 * 60 * 60 * 1000)
      ),
      fileManagementApproved: true,
      fileManagementApprovedAt: new Date(approvedAt.getTime() + 24 * 60 * 60 * 1000),
      fileManagementApprovedByUserID: fileManager.userID,
      accessRevoked: false,
      accessRevokedAt: null,
      accessRevokedByUserID: null,
      completedAt: null,
      createdAt: new Date(submittedAt.getTime() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(approvedAt.getTime() + 24 * 60 * 60 * 1000),
    },
  ]);

  await verifyDemoSeed();

  console.log(`[seed] verified. All demo accounts use password: ${DEMO_PASSWORD}`);
  console.log(`  File Management: ${fileManager.userID}`);
  console.log("  Department reviewers: <department-key>@demo.local");
  console.log("  IT item reviewers: it.<item-key>@demo.local");
  console.log("  DEMO-1001: completed, signed, and access revoked");
  console.log("  DEMO-1002: signed and approved; awaiting IT access revocation");

  process.exit(0);
}

run().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});
