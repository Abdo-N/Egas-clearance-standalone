const mongoose = require("mongoose");

/**
 * Evidence a reviewer uploaded when signing -- a photo/PDF of the physical
 * signature or stamp, captured fresh per request (see multer config in
 * request.routes.js). Stored on disk under backend/uploads/, this just
 * tracks where + what it is.
 */
const evidenceSchema = new mongoose.Schema(
  {
    fileUrl: { type: String, required: true }, // served via GET /requests/:id/evidence/...
    mimeType: { type: String, required: true },
    originalName: { type: String, required: true },
  },
  { _id: false }
);

/**
 * Snapshot of one IT checklist item's sign-off state for THIS request. We
 * copy Department("it").checklistItems into the request at creation time so
 * later template edits don't retroactively change requests already in
 * flight -- same snapshot pattern as `departments` below.
 */
const requestItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label_ar: { type: String, required: true },
    label_en: { type: String, required: true },
    assignedItemKey: { type: String, required: true }, // == key, kept for symmetry with User.assignedItemKey
    status: { type: String, enum: ["pending", "completed"], default: "pending" },
    signedByUserID: { type: String, default: null },
    signedByFullName: { type: String, default: null },
    signedAt: { type: Date, default: null },
    evidence: { type: evidenceSchema, default: null },
  },
  { _id: false }
);

const requestDepartmentSchema = new mongoose.Schema(
  {
    departmentKey: { type: String, required: true },
    name_ar: { type: String, required: true },
    name_en: { type: String, required: true },
    // Paper-form row number (1-13) -- see backend/src/services/clearancePdf.js,
    // which maps this straight to a hand-calibrated row on the scanned template.
    order: { type: Number, required: true },
    tier: { type: Number, required: true },
    hasOversightDashboard: { type: Boolean, default: false },
    signatureMode: { type: String, enum: ["single", "itemized"], required: true },
    status: { type: String, enum: ["pending", "completed"], default: "pending" },
    // Single-mode fields (unused when signatureMode === "itemized"):
    signedByUserID: { type: String, default: null },
    signedByFullName: { type: String, default: null },
    signedAt: { type: Date, default: null },
    evidence: { type: evidenceSchema, default: null },
    // Itemized-mode fields (IT only):
    items: { type: [requestItemSchema], default: [] },
  },
  { _id: false }
);

// Why the employee is leaving. "retirement" covers Egypt's mandatory
// retirement-at-60 policy, referred to as "المعاش". "early_retirement"
// ("معاش مبكر") is a separate, voluntary early-exit option.
const LEAVING_REASONS = ["resignation", "new_job", "retirement", "early_retirement"];

const clearanceRequestSchema = new mongoose.Schema(
  {
    // Snapshotted from Employee at submission (see POST / in
    // request.routes.js) so it doesn't drift if the employee's directory
    // record changes later.
    employeeNumber: { type: String, required: true },
    employeeFullName: { type: String, required: true },
    employeeJobTitle: { type: String, default: "" },
    employeeDepartment_ar: { type: String, default: "" },
    employeeDepartment_en: { type: String, default: "" },
    reason: { type: String, enum: LEAVING_REASONS, required: true },
    lastWorkingDay: { type: Date, required: true },
    // Which File Management user filed this request.
    createdByUserID: { type: String, required: true },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    departments: { type: [requestDepartmentSchema], default: [] },
    completedAt: { type: Date, default: null },
    // File Management's explicit sign-off that every department's evidence
    // is legible, given once all 13 have signed (POST /:id/approve-clearance)
    // -- IT's revoke-access route requires this in addition to allDepartmentsSigned().
    // Reopening any department/item (see .../reopen routes) resets this back
    // to false, since it re-approves a signature set that no longer exists.
    fileManagementApproved: { type: Boolean, default: false },
    fileManagementApprovedAt: { type: Date, default: null },
    fileManagementApprovedByUserID: { type: String, default: null },
    // Set only by the explicit IT "revoke system access" action
    // (POST /:id/revoke-access), never implicitly on completion.
    accessRevoked: { type: Boolean, default: false },
    accessRevokedAt: { type: Date, default: null },
    accessRevokedByUserID: { type: String, default: null },
  },
  { timestamps: true }
);

const ClearanceRequest = mongoose.model("ClearanceRequest", clearanceRequestSchema);
ClearanceRequest.LEAVING_REASONS = LEAVING_REASONS;
module.exports = ClearanceRequest;
