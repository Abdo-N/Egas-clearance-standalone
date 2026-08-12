const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Department = require("../models/Department");
const { isPasswordStrongEnough, MIN_LENGTH } = require("../utils/passwordPolicy");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

async function verifyPassword(userID, password) {
  const user = await User.findOne({ userID });
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
// account is now created via self-registration below, so in practice it
// always holds the person's email address.
router.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await User.findOne({ userID: email.trim().toLowerCase() });
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
 * Self-registration: anyone can create their own File Management or reviewer
 * account with an email + password, choosing their own role/department (and,
 * for IT, which of the 5 itemized checklist items they own) -- no approval
 * step. Department/item choices are still validated against real
 * `Department` data so a request's tier-locking and itemized-signing logic
 * never has to trust unvalidated input; the one integrity rule enforced here
 * is that each IT checklist item can only ever have one owning account.
 */
router.post("/register", asyncHandler(async (req, res) => {
  const { email, password, fullName, role, departmentKey, assignedItemKey, landlineNumber } = req.body;

  if (!email || !email.trim() || !fullName || !fullName.trim()) {
    return res.status(400).json({ error: "'email' and 'fullName' are required" });
  }
  if (!landlineNumber || !landlineNumber.trim()) {
    return res.status(400).json({ error: "'landlineNumber' is required" });
  }
  if (!["file_management", "reviewer"].includes(role)) {
    return res.status(400).json({ error: "'role' must be 'file_management' or 'reviewer'" });
  }
  if (!isPasswordStrongEnough(password)) {
    return res.status(400).json({ error: `Password must be at least ${MIN_LENGTH} characters and include a symbol` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ userID: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists" });
  }

  let department = null;
  if (role === "reviewer") {
    if (!departmentKey) {
      return res.status(400).json({ error: "'departmentKey' is required for a reviewer account" });
    }
    department = await Department.findOne({ key: departmentKey });
    if (!department) {
      return res.status(400).json({ error: "Unknown department" });
    }

    if (department.signatureMode === "itemized") {
      const item = department.checklistItems.find((i) => i.key === assignedItemKey);
      if (!item) {
        return res.status(400).json({ error: "'assignedItemKey' must be one of this department's checklist items" });
      }
      const itemTaken = await User.findOne({ departmentKey, assignedItemKey });
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

  const payload = await buildTokenPayload(user);
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });

  res.status(201).json({ token, user: payload });
}));

/**
 * PUBLIC (no auth) -- lets someone locked out of their account find out who
 * to contact for a one-time password without already having a token, which
 * is the whole problem. Same "public by necessity" reasoning as
 * GET /api/departments. Scoped to IT reviewers only, since only IT can issue
 * a reset (see POST /reset-password below). `landlineNumber` is already
 * shown to signers throughout the app once a department signs (see
 * CLAUDE.md), so surfacing it here too isn't a new exposure, just a new
 * place it's read from.
 */
router.get("/it-contacts", asyncHandler(async (req, res) => {
  const contacts = await User.find({ departmentKey: "it" })
    .select("fullName fullName_ar userID landlineNumber -_id")
    .sort({ fullName: 1 });
  res.json(contacts);
}));

// Shared by login and register: reviewers get their department's
// hasOversightDashboard flag (and display name) embedded in the token so
// route/UI logic never has to hardcode which department keys (wages,
// finance) get the oversight dashboard, or maintain a second copy of the
// department name list -- that's all config on Department, looked up once
// here.
async function buildTokenPayload(user) {
  let hasOversightDashboard = false;
  let departmentName_ar = null;
  let departmentName_en = null;
  if (user.role === "reviewer" && user.departmentKey) {
    const dept = await Department.findOne({ key: user.departmentKey });
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
 * REVIEWER (IT only): issue any account -- another IT reviewer, a plain
 * department reviewer, or File Management -- a fresh one-time password when
 * they've forgotten theirs and can't self-serve a reset (there's no email
 * infra in this app to send a reset link to, see CLAUDE.md). Re-authenticates
 * the ACTING IT reviewer's own password first, same re-auth-to-confirm
 * pattern as every sign/undo/revoke-access route. The plaintext one-time
 * password is returned only in this response, for IT to hand off directly
 * (phone call, in person) -- it's never stored anywhere in the clear.
 * `mustResetPassword` (see User.js) forces the target account to set a real
 * password on next login before touching anything else.
 */
router.post("/reset-password", requireAuth, requireRole("reviewer"), asyncHandler(async (req, res) => {
  if (req.user.departmentKey !== "it") {
    return res.status(403).json({ error: "Only IT can reset another account's password" });
  }
  const { userID, password } = req.body;
  if (!userID || !password) {
    return res.status(400).json({ error: "'userID' and 'password' are required" });
  }

  const actingPasswordOk = await verifyPassword(req.user.userID, password);
  if (!actingPasswordOk) return res.status(401).json({ error: "Incorrect password" });

  const targetEmail = userID.trim().toLowerCase();
  const target = await User.findOne({ userID: targetEmail });
  if (!target) return res.status(404).json({ error: "No account found with that email" });

  const oneTimePassword = generateOneTimePassword();
  target.passwordHash = await bcrypt.hash(oneTimePassword, 10);
  target.mustResetPassword = true;
  await target.save();

  res.json({ userID: target.userID, fullName: target.fullName, oneTimePassword });
}));

/**
 * REVIEWER (IT only): permanently delete ANY account -- another IT reviewer
 * (including the acting IT reviewer's own account), a plain department
 * reviewer, or File Management. Re-authenticates the ACTING IT reviewer's
 * own password first, same re-auth-to-confirm pattern as reset-password/
 * revoke-access. Safe to hard-delete: every place a signature is displayed
 * (ClearanceRequest.departments[]/items[]) already stores its own
 * signedByFullName/signedByLandlineNumber snapshot rather than joining
 * live against User, so deleting an account that has already signed
 * requests doesn't touch that history. No restrictions on which account
 * can be deleted -- including the last remaining IT account or the acting
 * IT reviewer's own -- that's judged IT's call to make, not something to
 * gate here. Takes effect immediately for the deleted account: requireAuth
 * re-checks the account still exists in the DB on every request, not just
 * at login.
 */
router.post("/delete-account", requireAuth, requireRole("reviewer"), asyncHandler(async (req, res) => {
  if (req.user.departmentKey !== "it") {
    return res.status(403).json({ error: "Only IT can delete accounts" });
  }
  const { userID, password } = req.body;
  if (!userID || !password) {
    return res.status(400).json({ error: "'userID' and 'password' are required" });
  }

  const actingPasswordOk = await verifyPassword(req.user.userID, password);
  if (!actingPasswordOk) return res.status(401).json({ error: "Incorrect password" });

  const targetEmail = userID.trim().toLowerCase();
  const target = await User.findOne({ userID: targetEmail });
  if (!target) return res.status(404).json({ error: "No account found with that email" });

  const deletedFullName = target.fullName;
  await target.deleteOne();

  res.json({ userID: targetEmail, fullName: deletedFullName });
}));

/**
 * Set a real password after logging in with a one-time password IT issued.
 * The only route a `mustResetPassword` token is allowed to hit (see
 * requireAuth in auth.middleware.js) -- still re-authenticates with the
 * one-time password itself (`currentPassword`) before accepting the new one,
 * same re-auth-to-confirm pattern as everywhere else in this app. Returns a
 * fresh token/user pair, same shape as login/register, since the old token's
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

  const user = await User.findOne({ userID: req.user.userID });
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
