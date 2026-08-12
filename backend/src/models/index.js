const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

/**
 * Single place every model is defined and associated -- avoids circular
 * requires between model files (User.js/Department.js/ClearanceRequest.js
 * are thin shims that just re-export from here, so every existing
 * `require("../models/User")` call site elsewhere in the app keeps working
 * unchanged).
 *
 * Column/attribute names deliberately mirror the old Mongoose schema field
 * names exactly (including its mix of snake_case `name_ar` and camelCase
 * `hasOversightDashboard`) rather than being renamed to a consistent SQL
 * convention -- every route handler, the seed scripts, and the composited
 * PDF generator (clearancePdf.js) already read/write those exact property
 * names, and keeping them identical is what lets that code carry over with
 * minimal changes instead of a parallel rename pass across the whole
 * codebase.
 */

const Department = sequelize.define(
  "Department",
  {
    // The natural key everywhere else in the app already uses (User.departmentKey,
    // request snapshots) -- no separate surrogate id needed.
    key: { type: DataTypes.STRING, primaryKey: true },
    name_ar: { type: DataTypes.STRING, allowNull: false },
    name_en: { type: DataTypes.STRING, allowNull: false },
    order: { type: DataTypes.INTEGER, allowNull: false },
    tier: { type: DataTypes.INTEGER, allowNull: false },
    hasOversightDashboard: { type: DataTypes.BOOLEAN, defaultValue: false },
    signatureMode: { type: DataTypes.ENUM("single", "itemized"), allowNull: false },
  },
  { tableName: "departments" }
);

// Template checklist items for IT (the only itemized department). Snapshotted
// onto RequestItem per-request at submission time, same as before.
const DepartmentChecklistItem = sequelize.define(
  "DepartmentChecklistItem",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    departmentKey: { type: DataTypes.STRING, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    label_ar: { type: DataTypes.STRING, allowNull: false },
    label_en: { type: DataTypes.STRING, allowNull: false },
  },
  {
    tableName: "department_checklist_items",
    indexes: [{ unique: true, fields: ["departmentKey", "key"] }],
  }
);

Department.hasMany(DepartmentChecklistItem, {
  as: "checklistItems",
  foreignKey: "departmentKey",
  onDelete: "CASCADE",
});
DepartmentChecklistItem.belongsTo(Department, { foreignKey: "departmentKey" });

const User = sequelize.define(
  "User",
  {
    // `userID` holds an email address (see User model comment history) --
    // already the natural, globally-unique identifier every other table
    // references it by, so it's the primary key directly.
    userID: { type: DataTypes.STRING, primaryKey: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    fullName: { type: DataTypes.STRING, allowNull: false },
    fullName_ar: { type: DataTypes.STRING, allowNull: true },
    role: { type: DataTypes.ENUM("file_management", "reviewer"), allowNull: false },
    departmentKey: { type: DataTypes.STRING, allowNull: true },
    assignedItemKey: { type: DataTypes.STRING, allowNull: true },
    landlineNumber: { type: DataTypes.STRING, allowNull: true },
    mustResetPassword: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  { tableName: "users" }
);

User.belongsTo(Department, { foreignKey: "departmentKey", targetKey: "key" });

const LEAVING_REASONS = [
  "death",
  "retirement",
  "early_retirement",
  "dismissal",
  "resignation",
  "secondment_end",
  "delegation_end",
  "assignment_end",
  "sister_company_transfer",
  "new_job",
  "driver_contract_end",
  "fixed_term_contract_end",
  "comprehensive_bonus_contract_end",
];

const ClearanceRequest = sequelize.define(
  "ClearanceRequest",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    employeeNumber: { type: DataTypes.STRING, allowNull: false },
    employeeFullName: { type: DataTypes.STRING, allowNull: false },
    employeeJobTitle: { type: DataTypes.STRING, defaultValue: "" },
    employeeDepartment_ar: { type: DataTypes.STRING, defaultValue: "" },
    employeeDepartment_en: { type: DataTypes.STRING, defaultValue: "" },
    reason: { type: DataTypes.ENUM(...LEAVING_REASONS), allowNull: false },
    lastWorkingDay: { type: DataTypes.DATE, allowNull: false },
    createdByUserID: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("in_progress", "completed"), defaultValue: "in_progress" },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    fileManagementApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
    fileManagementApprovedAt: { type: DataTypes.DATE, allowNull: true },
    fileManagementApprovedByUserID: { type: DataTypes.STRING, allowNull: true },
    accessRevoked: { type: DataTypes.BOOLEAN, defaultValue: false },
    accessRevokedAt: { type: DataTypes.DATE, allowNull: true },
    accessRevokedByUserID: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: "clearance_requests" }
);
ClearanceRequest.LEAVING_REASONS = LEAVING_REASONS;

// One row per department SNAPSHOTTED onto a specific request at submission
// time (replaces the old embedded `ClearanceRequest.departments[]` array) --
// later edits to the Department template must not retroactively change a
// request already in flight, so every display/business field is copied here,
// not looked up live via departmentKey.
const RequestDepartment = sequelize.define(
  "RequestDepartment",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    requestId: { type: DataTypes.UUID, allowNull: false },
    departmentKey: { type: DataTypes.STRING, allowNull: false },
    name_ar: { type: DataTypes.STRING, allowNull: false },
    name_en: { type: DataTypes.STRING, allowNull: false },
    order: { type: DataTypes.INTEGER, allowNull: false },
    tier: { type: DataTypes.INTEGER, allowNull: false },
    hasOversightDashboard: { type: DataTypes.BOOLEAN, defaultValue: false },
    signatureMode: { type: DataTypes.ENUM("single", "itemized"), allowNull: false },
    status: { type: DataTypes.ENUM("pending", "completed"), defaultValue: "pending" },
    signedByUserID: { type: DataTypes.STRING, allowNull: true },
    signedByFullName: { type: DataTypes.STRING, allowNull: true },
    signedByLandlineNumber: { type: DataTypes.STRING, allowNull: true },
    signedAt: { type: DataTypes.DATE, allowNull: true },
    evidenceFileUrl: { type: DataTypes.STRING, allowNull: true },
    evidenceMimeType: { type: DataTypes.STRING, allowNull: true },
    evidenceOriginalName: { type: DataTypes.STRING, allowNull: true },
    // Wages/Finance's optional free-text remark -- see the Mongoose schema's
    // original comment on this field for why it's only ever populated for
    // hasOversightDashboard departments.
    notes: { type: DataTypes.TEXT, defaultValue: "" },
  },
  {
    tableName: "request_departments",
    indexes: [{ unique: true, fields: ["requestId", "departmentKey"] }],
  }
);

// Snapshot of one IT checklist item's sign-off state for a specific request
// (replaces the old embedded `requestDepartmentSchema.items[]`).
const RequestItem = sequelize.define(
  "RequestItem",
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    requestDepartmentId: { type: DataTypes.INTEGER, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false },
    label_ar: { type: DataTypes.STRING, allowNull: false },
    label_en: { type: DataTypes.STRING, allowNull: false },
    assignedItemKey: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM("pending", "completed"), defaultValue: "pending" },
    signedByUserID: { type: DataTypes.STRING, allowNull: true },
    signedByFullName: { type: DataTypes.STRING, allowNull: true },
    signedByLandlineNumber: { type: DataTypes.STRING, allowNull: true },
    signedAt: { type: DataTypes.DATE, allowNull: true },
    evidenceFileUrl: { type: DataTypes.STRING, allowNull: true },
    evidenceMimeType: { type: DataTypes.STRING, allowNull: true },
    evidenceOriginalName: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: "request_items",
    indexes: [{ unique: true, fields: ["requestDepartmentId", "key"] }],
  }
);

ClearanceRequest.hasMany(RequestDepartment, {
  as: "departments",
  foreignKey: "requestId",
  onDelete: "CASCADE",
});
RequestDepartment.belongsTo(ClearanceRequest, { foreignKey: "requestId" });

RequestDepartment.hasMany(RequestItem, {
  as: "items",
  foreignKey: "requestDepartmentId",
  onDelete: "CASCADE",
});
RequestItem.belongsTo(RequestDepartment, { foreignKey: "requestDepartmentId" });

module.exports = {
  sequelize,
  Department,
  DepartmentChecklistItem,
  User,
  ClearanceRequest,
  RequestDepartment,
  RequestItem,
};
