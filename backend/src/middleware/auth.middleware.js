const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // A one-time password issued by an admin/super_admin (see
    // POST /auth/reset-password) only ever unlocks one route -- setting a
    // real password -- so a token minted right after that login can't be
    // used for anything else in the meantime. Checked here, not just in the
    // frontend, since the frontend check is cosmetic everywhere else in this
    // app too.
    if (payload.mustResetPassword && req.path !== "/set-new-password") {
      return res.status(403).json({ error: "You must set a new password before continuing", code: "PASSWORD_RESET_REQUIRED" });
    }
    // Re-checked against the DB (not just trusted from the JWT payload) so a
    // deleted account (see POST /auth/delete-account) is locked out
    // immediately instead of staying usable until its token naturally
    // expires -- the one place in this app's otherwise-stateless auth that
    // needs a live DB read on every request.
    const stillExists = await User.findByPk(payload.userID);
    if (!stillExists) {
      return res.status(401).json({ error: "Account no longer exists" });
    }
    req.user = payload; // { userID, fullName, role, departmentKey, assignedItemKey, landlineNumber, hasOversightDashboard }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden for this role" });
    }
    next();
  };
}

// Reviewer must be signing on behalf of their OWN department -- used by
// every sign/archive route in request.routes.js so this check lives in one
// place instead of being repeated inline.
function requireOwnDepartment(req, res, next) {
  if (req.user.role !== "reviewer" || req.user.departmentKey !== req.params.deptKey) {
    return res.status(403).json({ error: "You can only act on behalf of your own department" });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireOwnDepartment };
