const { sequelize, ClearanceRequest, RequestDepartment, RequestItem } = require("../models");

/**
 * Bridges the relational schema back to the exact plain-object shape the
 * pre-SQL Mongoose code already returned (and that the frontend, and every
 * business-logic helper in request.routes.js, already expects) --
 * `_id` instead of `id`, a nested `evidence: {fileUrl,mimeType,originalName}|null`
 * instead of three flat columns, department order/items nested under
 * `departments[]`. This is what lets request.routes.js's redaction/flag
 * functions (redactToOwnDepartment, accessRevocationFlags, etc.) and
 * clearancePdf.js keep working completely unchanged -- they only ever
 * operated on plain objects with these exact property names to begin with.
 */

const DEPARTMENTS_INCLUDE = {
  model: RequestDepartment,
  as: "departments",
  separate: true,
  order: [["order", "ASC"]],
  include: [
    {
      model: RequestItem,
      as: "items",
      separate: true,
      order: [["id", "ASC"]],
    },
  ],
};

function toEvidence(fileUrl, mimeType, originalName) {
  return fileUrl ? { fileUrl, mimeType, originalName } : null;
}

function itemToPlain(item) {
  return {
    key: item.key,
    label_ar: item.label_ar,
    label_en: item.label_en,
    assignedItemKey: item.assignedItemKey,
    status: item.status,
    signedByUserID: item.signedByUserID,
    signedByFullName: item.signedByFullName,
    signedByLandlineNumber: item.signedByLandlineNumber,
    signedAt: item.signedAt,
    evidence: toEvidence(item.evidenceFileUrl, item.evidenceMimeType, item.evidenceOriginalName),
  };
}

function departmentToPlain(dept) {
  return {
    departmentKey: dept.departmentKey,
    name_ar: dept.name_ar,
    name_en: dept.name_en,
    order: dept.order,
    tier: dept.tier,
    hasOversightDashboard: dept.hasOversightDashboard,
    signatureMode: dept.signatureMode,
    status: dept.status,
    signedByUserID: dept.signedByUserID,
    signedByFullName: dept.signedByFullName,
    signedByLandlineNumber: dept.signedByLandlineNumber,
    signedAt: dept.signedAt,
    evidence: toEvidence(dept.evidenceFileUrl, dept.evidenceMimeType, dept.evidenceOriginalName),
    notes: dept.notes || "",
    items: (dept.items || []).map(itemToPlain),
  };
}

function toPlainRequest(instance) {
  if (!instance) return null;
  const obj = instance.toJSON ? instance.toJSON() : instance;
  return {
    _id: obj.id,
    employeeNumber: obj.employeeNumber,
    employeeFullName: obj.employeeFullName,
    employeeJobTitle: obj.employeeJobTitle,
    employeeDepartment_ar: obj.employeeDepartment_ar,
    employeeDepartment_en: obj.employeeDepartment_en,
    reason: obj.reason,
    lastWorkingDay: obj.lastWorkingDay,
    createdByUserID: obj.createdByUserID,
    status: obj.status,
    departments: (obj.departments || []).map(departmentToPlain),
    completedAt: obj.completedAt,
    fileManagementApproved: obj.fileManagementApproved,
    fileManagementApprovedAt: obj.fileManagementApprovedAt,
    fileManagementApprovedByUserID: obj.fileManagementApprovedByUserID,
    accessRevoked: obj.accessRevoked,
    accessRevokedAt: obj.accessRevokedAt,
    accessRevokedByUserID: obj.accessRevokedByUserID,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

async function findRequestById(id) {
  const instance = await ClearanceRequest.findByPk(id, { include: [DEPARTMENTS_INCLUDE] });
  return toPlainRequest(instance);
}

async function findRequests(where) {
  const instances = await ClearanceRequest.findAll({
    where,
    include: [DEPARTMENTS_INCLUDE],
    order: [["createdAt", "DESC"]],
  });
  return instances.map(toPlainRequest);
}

// Creates a request plus one RequestDepartment (and, for itemized
// departments, one RequestItem per checklist item) per snapshotted
// department template -- same snapshot-at-submission-time semantics as the
// old embedded-array creation in POST /requests.
async function createRequest(fields, departmentTemplates) {
  const id = await sequelize.transaction(async (t) => {
    const request = await ClearanceRequest.create(fields, { transaction: t });
    for (const dept of departmentTemplates) {
      const rd = await RequestDepartment.create(
        {
          requestId: request.id,
          departmentKey: dept.key,
          name_ar: dept.name_ar,
          name_en: dept.name_en,
          order: dept.order,
          tier: dept.tier,
          hasOversightDashboard: dept.hasOversightDashboard,
          signatureMode: dept.signatureMode,
        },
        { transaction: t }
      );
      if (dept.signatureMode === "itemized") {
        for (const item of dept.checklistItems) {
          await RequestItem.create(
            {
              requestDepartmentId: rd.id,
              key: item.key,
              label_ar: item.label_ar,
              label_en: item.label_en,
              assignedItemKey: item.key,
            },
            { transaction: t }
          );
        }
      }
    }
    return request.id;
  });
  return findRequestById(id);
}

// Seed-only variant of createRequest: takes department rows that are already
// FULLY populated (status/signedBy*/evidence/items already set, same plain
// shape toPlainRequest produces) rather than building empty "pending"
// templates -- lets seed.js build already-signed demo requests without
// re-deriving this insertion logic.
async function insertRequestWithDepartments(fields, departmentRows) {
  const id = await sequelize.transaction(async (t) => {
    const request = await ClearanceRequest.create(fields, { transaction: t });
    for (const dept of departmentRows) {
      const rd = await RequestDepartment.create(
        {
          requestId: request.id,
          departmentKey: dept.departmentKey,
          name_ar: dept.name_ar,
          name_en: dept.name_en,
          order: dept.order,
          tier: dept.tier,
          hasOversightDashboard: dept.hasOversightDashboard,
          signatureMode: dept.signatureMode,
          status: dept.status,
          signedByUserID: dept.signedByUserID,
          signedByFullName: dept.signedByFullName,
          signedByLandlineNumber: dept.signedByLandlineNumber,
          signedAt: dept.signedAt,
          evidenceFileUrl: dept.evidence?.fileUrl || null,
          evidenceMimeType: dept.evidence?.mimeType || null,
          evidenceOriginalName: dept.evidence?.originalName || null,
          notes: dept.notes || "",
        },
        { transaction: t }
      );
      for (const item of dept.items || []) {
        await RequestItem.create(
          {
            requestDepartmentId: rd.id,
            key: item.key,
            label_ar: item.label_ar,
            label_en: item.label_en,
            assignedItemKey: item.assignedItemKey,
            status: item.status,
            signedByUserID: item.signedByUserID,
            signedByFullName: item.signedByFullName,
            signedByLandlineNumber: item.signedByLandlineNumber,
            signedAt: item.signedAt,
            evidenceFileUrl: item.evidence?.fileUrl || null,
            evidenceMimeType: item.evidence?.mimeType || null,
            evidenceOriginalName: item.evidence?.originalName || null,
          },
          { transaction: t }
        );
      }
    }
    return request.id;
  });
  return findRequestById(id);
}

async function updateRequest(requestId, fields) {
  await ClearanceRequest.update(fields, { where: { id: requestId } });
}

async function updateRequestDepartment(requestId, departmentKey, fields) {
  await RequestDepartment.update(fields, { where: { requestId, departmentKey } });
}

async function updateRequestItem(requestId, departmentKey, itemKey, fields) {
  const rd = await RequestDepartment.findOne({ where: { requestId, departmentKey } });
  if (!rd) return;
  await RequestItem.update(fields, { where: { requestDepartmentId: rd.id, key: itemKey } });
}

async function deleteRequest(requestId) {
  // RequestDepartment/RequestItem rows cascade via the FK's ON DELETE CASCADE.
  await ClearanceRequest.destroy({ where: { id: requestId } });
}

module.exports = {
  toPlainRequest,
  findRequestById,
  findRequests,
  createRequest,
  insertRequestWithDepartments,
  updateRequest,
  updateRequestDepartment,
  updateRequestItem,
  deleteRequest,
};
