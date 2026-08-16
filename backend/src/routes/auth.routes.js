const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const User = require("../models/User");
const Department = require("../models/Department");
const { isPasswordStrongEnough, MIN_LENGTH } = require("../utils/passwordPolicy");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

async function verifyPassword(userID, password) {
  const user = await User.findByPk(userID);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

// Random enough for a credential that's only ever meant to be used once and
// immediately replaced, and always satisfies isPasswordStrongEnough on its
// own (12 chars, trailing symbol) so it never has to go through the normal
// strength check. Excludes visually-ambiguous characters (0/O, 1/l/I) since
// IT reads this out loud or over an internal phone line to hand it off.
function generateOneTimePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 11; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${code}!`;
}

// Login by email + password. `userID` is the underlying field name (kept as
// unchanged plumbing throughout the codebase -- see User.js) but every
// account is created by an admin or super_admin (see POST /accounts below),
// so in practice it always holds the person's email address.
router.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await User.findByPk(email.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const payload = await buildTokenPayload(user);
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

  res.json({ token, user: payload });
}));

/**
 * PUBLIC (no auth) -- tells the frontend whether this is a genuinely
 * brand-new deployment (zero accounts exist yet) so `Login.jsx` can redirect
 * straight to `/setup` (`FirstRunSetup.jsx`) instead of showing a login form
 * nobody could ever actually use yet. See CLAUDE.md's "admin-managed
 * accounts, no AD" section -- this replaced an earlier design
 * (`seed:final` auto-creating a bootstrap admin with a fixed default
 * password) with an in-browser first-run flow instead, so there's no
 * well-known default credential pair sitting in the codebase/docs.
 */
router.get("/setup-status", asyncHandler(async (req, res) => {
  const accountCount = await User.count();
  res.json({ needsSetup: accountCount === 0 });
}));

/**
 * PUBLIC (no auth), but only ever works ONCE: creates the very first
 * super_admin account on a brand-new deployment where zero accounts exist
 * yet -- the root of the whole account hierarchy (super_admin creates
 * admins, admins create everyone else, see "admin-managed accounts, no AD"
 * in CLAUDE.md). This is the one place in the whole app an unauthenticated
 * request can create an account, so the guard has to be airtight, not just a
 * UX nicety -- it re-checks the count at request time rather than trusting
 * the frontend's earlier GET /setup-status. The instant any account exists
 * (which in practice only ever happens via this route or POST /auth/accounts
 * by a super_admin/admin -- there's no other way an account comes into
 * existence), this route 409s permanently and every other account from then
 * on is created through POST /auth/accounts. No transaction/row-lock around
 * the count-then-create -- the realistic scenario is exactly one person
 * deploying and setting this up, not concurrent requests racing to be
 * "first", same low-ceremony philosophy as the rest of this app (see
 * CLAUDE.md "Commands": no CI, no rate limiting either).
 */
router.post("/setup", asyncHandler(async (req, res) => {
  const accountCount = await User.count();
  if (accountCount > 0) {
    return res.status(409).json({ error: "Setup has already been completed" });
  }

  const { email, password, fullName, landlineNumber } = req.body;
  if (!email || !email.trim() || !fullName || !fullName.trim()) {
    return res.status(400).json({ error: "'email' and 'fullName' are required" });
  }
  if (!landlineNumber || !landlineNumber.trim()) {
    return res.status(400).json({ error: "'landlineNumber' is required" });
  }
  if (!isPasswordStrongEnough(password)) {
    return res.status(400).json({ error: `Password must be at least ${MIN_LENGTH} characters and include a symbol` });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    userID: email.trim().toLowerCase(),
    passwordHash,
    fullName: fullName.trim(),
    role: "super_admin",
    landlineNumber: landlineNumber.trim(),
  });

  const payload = await buildTokenPayload(user);
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

  res.status(201).json({ token, user: payload });
}));

// An admin manages only the "sub accounts" (File Management, department
// reviewers) that actually do clearance work; a super_admin manages only
// admin accounts. Neither tier can touch the other's accounts -- enforced
// here, in one place, rather than duplicated across every route below that
// takes a target account (create/list/reset-password/delete-account). IT
// used to have a separate, unrestricted "any account" reset-password/
// delete-account power; that escape hatch was removed 2026-08-13 (Nader) --
// IT reviewers are ordinary account holders now, same as everyone outside
// the admin/super_admin tiers, and are managed like any other reviewer
// account (an admin can reset/delete them, same as any reviewer). Note this
// reopens the lockout gap the escape hatch used to close: nothing can
// reset/delete the sole super_admin account if it's ever locked out, since
// `super_admin` never appears in this map and can't self-target either.
//
// Deliberately NOT `super_admin: ["admin", "super_admin"]`: there is only
// ever supposed to be ONE super_admin account, created once by
// POST /auth/setup on a genuinely empty database (see that route below) --
// a super_admin must never be able to create another one. Since
// `"super_admin"` never appears in ANY actor's list here, POST /accounts
// structurally can't create a second one no matter who calls it; this map
// is the only place that invariant needs to be enforced.
const MANAGEABLE_ROLES_BY_ACTOR = {
  admin: ["file_management", "reviewer"],
  super_admin: ["admin"],
};

/**
 * ADMIN OR SUPER_ADMIN: list every account this actor is allowed to manage --
 * an admin sees only File Management/reviewer accounts, a super_admin sees
 * only admin accounts (see `MANAGEABLE_ROLES_BY_ACTOR` above). Enforced
 * server-side, not just a filtered-down UI, same need-to-know philosophy as
 * request.routes.js's redaction rules. No `passwordHash`.
 */
router.get("/accounts", requireAuth, requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const accounts = await User.findAll({
    where: { role: MANAGEABLE_ROLES_BY_ACTOR[req.user.role] },
    attributes: [
      "userID", "fullName", "fullName_ar", "role",
      "departmentKey", "assignedItemKey", "landlineNumber", "mustResetPassword",
    ],
    order: [["role", "ASC"], ["fullName", "ASC"]],
  });
  res.json(accounts);
}));

/**
 * ADMIN OR SUPER_ADMIN: create an account directly, scoped to what this actor
 * is allowed to manage (`MANAGEABLE_ROLES_BY_ACTOR` above) -- an admin
 * creates File Management or reviewer accounts (with department and, for IT,
 * which of the 5 itemized checklist items they own); a super_admin creates
 * admin accounts (and ONLY admin accounts -- there is exactly one
 * super_admin ever, see the comment on `MANAGEABLE_ROLES_BY_ACTOR` above,
 * so this route 403s if a super_admin tries to create another one).
 * Replaces self-registration: there is no more approval-free sign-up, an
 * admin/super_admin is now the only way a new account comes into existence.
 * Re-authenticates the ACTING user's own
 * password first, same re-auth-to-confirm pattern as every other
 * consequential action here. Department/item choices are still validated
 * against real `Department` data so a request's tier-locking and
 * itemized-signing logic never has to trust unvalidated input; the one
 * integrity rule enforced here (carried over from the old register route) is
 * that each IT checklist item can only ever have one owning account.
 * Deliberately does NOT return a token for the new account -- the acting
 * user creating it isn't logging in as it.
 */
router.post("/accounts", requireAuth, requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { currentPassword, email, password, fullName, role, departmentKey, assignedItemKey, landlineNumber } = req.body;
  if (!currentPassword) {
    return res.status(400).json({ error: "'currentPassword' is required" });
  }
  const actingPasswordOk = await verifyPassword(req.user.userID, currentPassword);
  if (!actingPasswordOk) return res.status(401).json({ error: "Incorrect password" });

  if (!email || !email.trim() || !fullName || !fullName.trim()) {
    return res.status(400).json({ error: "'email' and 'fullName' are required" });
  }
  if (!landlineNumber || !landlineNumber.trim()) {
    return res.status(400).json({ error: "'landlineNumber' is required" });
  }
  const manageableRoles = MANAGEABLE_ROLES_BY_ACTOR[req.user.role];
  if (!manageableRoles.includes(role)) {
    return res.status(403).json({ error: `As a(n) ${req.user.role}, 'role' must be one of: ${manageableRoles.join(", ")}` });
  }
  if (!isPasswordStrongEnough(password)) {
    return res.status(400).json({ error: `Password must be at least ${MIN_LENGTH} characters and include a symbol` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findByPk(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  let department = null;
  if (role === "reviewer") {
    if (!departmentKey) {
      return res.status(400).json({ error: "'departmentKey' is required for a reviewer account" });
    }
    department = await Department.findByPk(departmentKey, { include: ["checklistItems"] });
    if (!department) {
      return res.status(400).json({ error: "Unknown department" });
    }

    if (department.signatureMode === "itemized") {
      const item = department.checklistItems.find((i) => i.key === assignedItemKey);
      if (!item) {
        return res.status(400).json({ error: "'assignedItemKey' must be one of this department's checklist items" });
      }
      const itemTaken = await User.findOne({ where: { departmentKey, assignedItemKey } });
      if (itemTaken) {
        return res.status(409).json({ error: "That checklist item already has an account assigned to it" });
      }
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    userID: normalizedEmail,
    passwordHash,
    fullName: fullName.trim(),
    role,
    departmentKey: role === "reviewer" ? departmentKey : null,
    assignedItemKey: role === "reviewer" && department.signatureMode === "itemized" ? assignedItemKey : null,
    landlineNumber: landlineNumber.trim(),
  });

  res.status(201).json({
    userID: user.userID,
    fullName: user.fullName,
    role: user.role,
    departmentKey: user.departmentKey,
    assignedItemKey: user.assignedItemKey,
    landlineNumber: user.landlineNumber,
  });
}));

/**
 * PUBLIC (no auth) -- lets someone reach IT directly without already having
 * a token. Same "public by necessity" reasoning as GET /api/departments.
 * IT used to be who this route existed for specifically -- the original,
 * unrestricted way to issue any account a password reset -- but that power
 * was removed 2026-08-13 (Nader): IT can no longer reset or delete
 * accounts, only an admin/super_admin can (GET /admin-contacts, right
 * below, is the route to use for a forgotten password now -- see
 * `Login.jsx`'s "Forgot your password?" disclosure). This route is kept for
 * IT's other legitimate role as a general contact point (e.g.
 * `SupportModal.jsx`'s "Need help?" widget). `landlineNumber` is already
 * shown to signers throughout the app once a department signs (see
 * CLAUDE.md), so surfacing it here too isn't a new exposure, just a new
 * place it's read from.
 */
router.get("/it-contacts", asyncHandler(async (req, res) => {
  const contacts = await User.findAll({
    where: { departmentKey: "it" },
    attributes: ["fullName", "fullName_ar", "userID", "landlineNumber"],
    order: [["fullName", "ASC"]],
  });
  res.json(contacts);
}));

/**
 * PUBLIC (no auth) -- same reasoning as GET /it-contacts above, for admins
 * and super_admins: lets someone reach an admin directly (e.g. to request a
 * brand-new account, now that self-registration is gone, or as a second
 * option alongside IT for a password reset) without already having a token.
 * Same shape, same fields, just filtered to `role: "admin"`/`"super_admin"`
 * instead of `departmentKey: "it"`.
 */
router.get("/admin-contacts", asyncHandler(async (req, res) => {
  const contacts = await User.findAll({
    where: { role: { [Op.in]: ["admin", "super_admin"] } },
    attributes: ["fullName", "fullName_ar", "userID", "landlineNumber", "role"],
    order: [["fullName", "ASC"]],
  });
  res.json(contacts);
}));

// Shared by every route that mints a token (login, set-new-password):
// reviewers get their department's hasOversightDashboard flag (and display
// name) embedded in the token so
// route/UI logic never has to hardcode which department keys (wages,
// finance) get the oversight dashboard, or maintain a second copy of the
// department name list -- that's all config on Department, looked up once
// here.
async function buildTokenPayload(user) {
  let hasOversightDashboard = false;
  let departmentName_ar = null;
  let departmentName_en = null;
  if (user.role === "reviewer" && user.departmentKey) {
    const dept = await Department.findByPk(user.departmentKey);
    hasOversightDashboard = Boolean(dept?.hasOversightDashboard);
    departmentName_ar = dept?.name_ar || null;
    departmentName_en = dept?.name_en || null;
  }

  return {
    userID: user.userID,
    fullName: user.fullName,
    fullName_ar: user.fullName_ar || null,
    role: user.role,
    departmentKey: user.departmentKey,
    assignedItemKey: user.assignedItemKey,
    landlineNumber: user.landlineNumber || null,
    hasOversightDashboard,
    departmentName_ar,
    departmentName_en,
    mustResetPassword: Boolean(user.mustResetPassword),
  };
}

/**
 * ADMIN OR SUPER_ADMIN: issue an account a fresh one-time password when
 * they've forgotten theirs and can't self-serve a reset (there's no email
 * infra in this app to send a reset link to, see CLAUDE.md). Scoped to what
 * this actor is allowed to manage (`MANAGEABLE_ROLES_BY_ACTOR` above): an
 * admin can reset a File Management/reviewer account (IT reviewers
 * included -- they're an ordinary reviewer account for this purpose) but
 * NOT another admin or the super_admin; a super_admin can reset an admin
 * account but NOT a sub account (and not another super_admin -- there
 * isn't one). IT used to have a separate, unrestricted "any account" power
 * here; that escape hatch was removed 2026-08-13 (Nader) -- see the comment
 * on `MANAGEABLE_ROLES_BY_ACTOR` above for the lockout gap this reopens.
 * Re-authenticates the ACTING user's own password first, same
 * re-auth-to-confirm pattern as every sign/undo/revoke-access route. The
 * plaintext one-time password is returned only in this response, for the
 * acting user to hand off directly (phone call, in person) -- it's never
 * stored anywhere in the clear. `mustResetPassword` (see User.js) forces the
 * target account to set a real password on next login before touching
 * anything else.
 */
router.post("/reset-password", requireAuth, requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { userID, password } = req.body;
  if (!userID || !password) {
    return res.status(400).json({ error: "'userID' and 'password' are required" });
  }

  const actingPasswordOk = await verifyPassword(req.user.userID, password);
  if (!actingPasswordOk) return res.status(401).json({ error: "Incorrect password" });

  const targetEmail = userID.trim().toLowerCase();
  const target = await User.findByPk(targetEmail);
  if (!target) return res.status(404).json({ error: "No account found with that email" });

  if (!MANAGEABLE_ROLES_BY_ACTOR[req.user.role].includes(target.role)) {
    return res.status(403).json({ error: `As a(n) ${req.user.role}, you can't manage a(n) ${target.role} account` });
  }

  const oneTimePassword = generateOneTimePassword();
  target.passwordHash = await bcrypt.hash(oneTimePassword, 10);
  target.mustResetPassword = true;
  await target.save();

  res.json({ userID: target.userID, fullName: target.fullName, oneTimePassword });
}));

/**
 * ADMIN OR SUPER_ADMIN: permanently delete an account, same scoping as
 * POST /reset-password above -- an admin is limited to File
 * Management/reviewer accounts (IT reviewers included -- they're an
 * ordinary reviewer account for this purpose -- but NOT another admin, the
 * super_admin, or even the acting admin's own account, since "admin" never
 * appears in its own `MANAGEABLE_ROLES_BY_ACTOR` entry); a super_admin is
 * limited to admin accounts (NOT its own, and there's no other super_admin to
 * target). IT used to have a separate, unrestricted "any account" power
 * here; that escape hatch was removed 2026-08-13 (Nader) -- see the comment
 * on `MANAGEABLE_ROLES_BY_ACTOR` above for the lockout gap this reopens.
 * Re-authenticates the ACTING user's own password first, same
 * re-auth-to-confirm pattern as reset-password/revoke-access. Safe to
 * hard-delete: every place a signature is displayed
 * (RequestDepartment/RequestItem) already stores its own
 * signedByFullName/signedByLandlineNumber snapshot rather than joining
 * live against User (see CLAUDE.md "Data layer"), so deleting an account
 * that has already signed requests doesn't touch that history. No
 * restrictions beyond the tier scoping above -- including deleting the last
 * remaining account in a manageable role -- that's judged the acting user's
 * call to make, not something to gate here. Takes effect immediately for
 * the deleted account: requireAuth re-checks the account still exists in
 * the DB on every request, not just at login.
 */
router.post("/delete-account", requireAuth, requireRole("admin", "super_admin"), asyncHandler(async (req, res) => {
  const { userID, password } = req.body;
  if (!userID || !password) {
    return res.status(400).json({ error: "'userID' and 'password' are required" });
  }

  const actingPasswordOk = await verifyPassword(req.user.userID, password);
  if (!actingPasswordOk) return res.status(401).json({ error: "Incorrect password" });

  const targetEmail = userID.trim().toLowerCase();
  const target = await User.findByPk(targetEmail);
  if (!target) return res.status(404).json({ error: "No account found with that email" });

  if (!MANAGEABLE_ROLES_BY_ACTOR[req.user.role].includes(target.role)) {
    return res.status(403).json({ error: `As a(n) ${req.user.role}, you can't manage a(n) ${target.role} account` });
  }

  const deletedFullName = target.fullName;
  await target.destroy();

  res.json({ userID: targetEmail, fullName: deletedFullName });
}));

/**
 * Set a real password after logging in with a one-time password an
 * admin/super_admin issued.
 * The only route a `mustResetPassword` token is allowed to hit (see
 * requireAuth in auth.middleware.js) -- still re-authenticates with the
 * one-time password itself (`currentPassword`) before accepting the new one,
 * same re-auth-to-confirm pattern as everywhere else. Returns a
 * fresh token/user pair, same shape as login, since the old token's
 * `mustResetPassword: true` is now stale.
 */
router.post("/set-new-password", requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "'currentPassword' and 'newPassword' are required" });
  }
  if (!isPasswordStrongEnough(newPassword)) {
    return res.status(400).json({ error: `Password must be at least ${MIN_LENGTH} characters and include a symbol` });
  }

  const user = await User.findByPk(req.user.userID);
  if (!user) return res.status(404).json({ error: "Account not found" });

  const currentOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentOk) return res.status(401).json({ error: "Incorrect current password" });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustResetPassword = false;
  await user.save();

  const payload = await buildTokenPayload(user);
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

  res.json({ token, user: payload });
}));

module.exports = router;
