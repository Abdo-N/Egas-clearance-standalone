const mongoose = require("mongoose");

/**
 * Staff logins (File Management + department reviewers), self-registered via
 * POST /auth/register -- see auth.routes.js. Anyone can create an account,
 * choosing their own role/department (and, for IT, which checklist item they
 * own) with no approval step; the only integrity rule enforced at signup is
 * that an IT checklist item can't be claimed by more than one account.
 *
 * Employees being cleared are NOT in this collection and never log in -- File
 * Management enters their data directly on the clearance-request form.
 */
const userSchema = new mongoose.Schema(
  {
    userID: { type: String, required: true, unique: true, trim: true }, // the account's email address
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true },
    // Optional localized display name. Self-registered accounts fall back to
    // `fullName`; deterministic demo accounts provide both languages.
    fullName_ar: { type: String, default: null },
    role: {
      type: String,
      enum: ["file_management", "reviewer"],
      required: true,
    },
    // Only set when role === "reviewer": which of the 13 clearance
    // departments this person reviews for. A department can have any number
    // of reviewer accounts (any one of them signing is enough, except IT --
    // see assignedItemKey).
    departmentKey: { type: String, default: null },
    // Only set for IT reviewers (departmentKey === "it"): which of IT's
    // itemized checklist items this specific person is responsible for
    // signing. Must match one of Department("it").checklistItems[].key.
    assignedItemKey: { type: String, default: null },
    // Company internal/landline number ("رقم الهاتف الداخلي"), required at
    // registration (enforced in auth.routes.js, not here, so seed data can
    // still create accounts directly) -- lets File Management/oversight
    // reach a signer directly instead of just seeing their name on a
    // signed department (see signedByLandlineNumber on ClearanceRequest).
    landlineNumber: { type: String, default: null },
    // Set when any IT reviewer issues this account a one-time password via
    // POST /auth/reset-password (see auth.routes.js) -- forces the very next
    // login to go straight to POST /auth/set-new-password before touching
    // anything else (enforced in auth.middleware.js's requireAuth, not just
    // the frontend), so the one-time password can't linger as a permanent
    // credential.
    mustResetPassword: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
