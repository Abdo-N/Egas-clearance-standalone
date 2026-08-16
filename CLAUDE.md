# EGAS Employee Clearance System — CLAUDE.md

Read this before doing anything else in this repo. If you're a team member new to
fullstack dev, read PROJECT_STATUS.md too — it tells you exactly what's built
and what's still open.

## What this project is

Digitizing EGAS's paper-based employee clearance ("إخلاء طرف") process. When an
employee retires or resigns, **File Management (`role: "file_management"`,
displayed to users as "إدارة الوثائق و السجلات" / "Document and Records
Management" — renamed 2026-08-11, the internal role key is unchanged)** files a
clearance request on their behalf — the employee never logs in. Each of the 13
departments on the paper form then reviews and signs off on that employee.
Departments 1–11 sign in parallel; the last two (Wages, Financial Affairs) are
gated behind all of the first 11 and get a full oversight dashboard. IT is
department #10 and, once every one of the 13 has signed, gets a manual
"Revoke access" action (disabling the departing employee's system access).
General rule: an employee is never actually cleared just because every
department signed off — revoking their access is the real final step, not a
formality after the fact, so the request only reads as "completed" once IT
has done that too.

The real department list and paper-form order are in
`backend/assets/clearance-form-template.pdf` (a digital copy of the "إخلاء
طرف" form, currently a native Word-exported PDF rather than a scan — see
"Compositing signatures onto the paper form" below) and mirrored in
`backend/src/seed/departments.data.js`. This file only covers how the
codebase is organized.

## Stack

- Backend: Node.js + Express + PostgreSQL (Sequelize, migrated from MongoDB
  2026-08-12 -- see "Data layer: PostgreSQL via Sequelize" below). JWT auth.
  `multer` for evidence-photo/PDF uploads, `pdf-lib` for compositing
  signatures onto the paper-form template, `pngjs`/`jpeg-js` for stripping
  evidence photos' white backgrounds before compositing.
- Frontend: React + Vite + React Router + react-i18next (Arabic/English, RTL support).
- Everything is JavaScript (no TypeScript) to keep the learning curve low for a
  team that is mostly new to fullstack dev.

## Repo layout

```
egas-clearance/
  backend/
    assets/
      clearance-form-template.pdf   the paper-form template -- the compositing target
    src/
      config/db.js          Sequelize/Postgres connection
      models/index.js        every Sequelize model + association (User, Department,
                              DepartmentChecklistItem, ClearanceRequest,
                              RequestDepartment, RequestItem); models/User.js,
                              Department.js, ClearanceRequest.js are thin
                              re-export shims into it
      services/requestAssembly.js   bridges the relational schema back to the
                              plain-object shape (nested departments[]/items[],
                              `_id`) every route handler and clearancePdf.js
                              already expect -- see "Data layer" below
      routes/                auth, department, request routes
      middleware/            JWT auth + role guards
      services/clearancePdf.js   composites signature evidence onto the template PDF
      utils/asyncHandler.js  wraps async route handlers so a thrown error
                              can't crash the whole process (Express 4 doesn't
                              catch rejected promises on its own)
      utils/passwordPolicy.js  the 12-char + symbol rule admin-created
                              accounts (and self-chosen new passwords) enforce
      seed/                  department templates plus deterministic demo
                              accounts/requests; account creation otherwise
                              only happens through an admin (auth.routes.js),
                              or `seedDepartments.js`'s one-time bootstrap
                              admin for a real deployment
    uploads/                 gitignored -- uploaded signature evidence, one
                              subfolder per request ID
    scripts/smoke-test.js   manual end-to-end test against a running seeded
                              server (admin-provisions its own throwaway
                              accounts/request)
  frontend/
    src/
      api/client.js          axios instance, attaches JWT automatically
      context/AuthContext.jsx, ThemeContext.jsx
      pages/                 Login, FirstRunSetup, SetNewPassword,
                              FileManagementDashboard, ReviewerDashboard,
                              AdminDashboard
      components/            SignaturePanel, RequestOversightGrid, EvidencePreview,
                              DepartmentDashboard, DepartmentIcon, LanguageToggle,
                              TopBarControls, BusinessDoodleBg
      utils/                 formatDate.js, leavingReason.js (small shared helpers)
      assets/                EGAS logo + login background
      locales/               en.json, ar.json for i18next
      i18n.js
  PROJECT_STATUS.md   living status tracker — update this as you finish tasks
```

## Data layer: PostgreSQL via Sequelize (migrated 2026-08-12)

This app ran on MongoDB/Mongoose from the original build through 2026-08-11;
it's PostgreSQL/Sequelize as of 2026-08-12. The relational schema
(`backend/src/models/index.js`) mirrors the old document shape as closely as
a normalized schema allows:

- `departments` (PK `key`, the same natural key `User.departmentKey` and
  every request snapshot already used -- no separate surrogate id) has a
  `department_checklist_items` child table (IT's 5 template items).
- `users` (PK `userID`, the account's email -- already the natural,
  globally-unique identifier everything else references it by).
- `clearance_requests` (PK `id`, a UUID -- Mongo's ObjectId equivalent) has a
  `request_departments` child table, one row per department SNAPSHOTTED onto
  that request at submission time (replacing the old embedded
  `departments[]` array -- same "don't retroactively change a request
  already in flight" reasoning as before), which itself has a
  `request_items` child table for IT's 5 itemized signatures (replacing the
  old embedded `items[]`).

Column/attribute names deliberately still match the old Mongoose field names
exactly, including the original mix of snake_case (`name_ar`) and camelCase
(`hasOversightDashboard`) -- not a SQL-convention rename pass, so every place
that already read/wrote those exact property names keeps working.

**The compatibility shim that made this a faithful rewrite instead of a
rewrite-everything project**: `backend/src/services/requestAssembly.js`'s
`toPlainRequest()` converts a fetched `ClearanceRequest` (with its
`RequestDepartment`/`RequestItem` rows eagerly included) back into the exact
plain-object shape Mongoose's `.toObject()` used to produce -- `_id` (not
`id`, since the frontend references `request._id` throughout and this was a
backend-only migration), nested `departments[].items[]`, a reconstructed
`evidence: {fileUrl,mimeType,originalName}|null` from three flat columns
instead of three separate ones. Every pure business-logic helper in
`request.routes.js` (`allDepartmentsSigned`, `computeOverallStatus`,
`isDepartmentUnlocked`, `redactToOwnDepartment`, `withOwnDepartmentAnnotated`,
`summarizeForFileManagement`, `accessRevocationFlags`, `isPendingForReviewer`)
and `clearancePdf.js`'s `generateClearancePdf()` are **completely unchanged**
from the Mongoose era -- they only ever operated on plain objects with these
exact property names, never on Mongoose documents directly, so this shim is
the entire adaptation layer. Write routes fetch the plain object for
validation (reusing that same unchanged logic), persist only the columns
that actually changed via targeted Sequelize `.update()` calls, then
re-fetch fresh from the DB before responding (`refreshAndSyncStatus()` in
`request.routes.js`) rather than trying to keep an in-memory shadow object in
sync with what was written -- simpler and safer at this app's tiny scale
than the alternative.

No separate migrations directory: `config/db.js` calls
`sequelize.sync({ alter: true })` at startup, matching Mongoose's old
implicit collection creation and the same low-ceremony philosophy the rest
of this repo already follows (no CI pipeline either, see "Commands" below).
`DATABASE_URL` (a standard `postgres://` connection string) replaces the old
`MONGO_URI` in `.env`.

## The most important design decision: admin-managed accounts, no AD

There is no Active Directory integration, mocked or otherwise, and there
never was a real one planned for staff logins. There also used to be
open self-registration (`POST /auth/register`, no approval step) through
2026-08-13 — that route is gone. As of 2026-08-13 (Nader), an `admin` role
is the only way a `backend/src/models/User.js` account comes into
existence: `POST /auth/accounts` (`backend/src/routes/auth.routes.js`,
admin-only, re-authenticating with the ACTING admin's own password first,
same re-auth-to-confirm pattern as every other consequential action here)
picks the new account's role (`file_management` or `reviewer`) and, for a
reviewer, department (and, for IT, which checklist item), fields that used
to be self-selected at sign-up. The one integrity rule from the old
register route carries over unchanged: an IT checklist item can only ever
have one account assigned to it (`assignedItemKey` uniqueness, checked
against existing `User`s). `departmentKey`/`assignedItemKey` choices are
still validated against real `Department` data (`GET /api/departments`
stays intentionally public — no auth — so `AdminDashboard.jsx`'s
create-account form can populate its department/item pickers). Login is by
email + password (`userID` is still the underlying field name on `User`,
just holds an email now instead of an AD-style username — see the comment
in `User.js`). Account creation also requires a `landlineNumber` (company
internal/extension line, "رقم الهاتف الداخلي") for every role, not just
reviewers — this isn't an integrity rule like the IT item check, just a
required field, enforced in the route rather than the schema so seed data
can still create accounts directly. Every other file just receives a JWT
with `{ userID, fullName, role, departmentKey, assignedItemKey,
landlineNumber, hasOversightDashboard, mustResetPassword }` and doesn't care
how the account was created — `role: "admin"` (or `"super_admin"`, see
below) flows through this same payload shape, it just has `departmentKey`/
`assignedItemKey` always `null` and never gets `hasOversightDashboard`
(that lookup is gated on `role === "reviewer"`).

**A second role, `super_admin`, sits one level above `admin` and exists
solely to manage `admin` accounts (2026-08-13, Nader)** — the same
"someone has to be able to manage the account managers, and it can't be the
account managers themselves" reasoning that produced the `admin` role in
the first place, one layer up. `POST /auth/accounts` /
`POST /auth/reset-password` / `POST /auth/delete-account` /
`GET /auth/accounts` are the SAME routes both roles use (no separate
super-admin-only routes) — `auth.routes.js`'s `MANAGEABLE_ROLES_BY_ACTOR`
map is the one place the split lives: an `admin` can create/list/reset/
delete only `file_management`/`reviewer` accounts, a `super_admin` can
create/list/reset/delete only `admin` accounts. **There is exactly ONE
`super_admin` account, ever — it cannot create another one.**
`MANAGEABLE_ROLES_BY_ACTOR.super_admin` is `["admin"]`, deliberately not
including `"super_admin"` itself, so `POST /accounts` structurally 403s on
`role: "super_admin"` no matter who calls it; the sole `super_admin` is
created once, by `POST /auth/setup` on a genuinely empty database (see
below), and that is the only way one ever comes into existence. Neither
tier can touch the other's accounts, and critically, **an admin can no
longer manage another admin at all** — closing off the one gap the old
single-`admin`-role design had, where any admin could reset or delete any
other admin including itself out. IT used to have a separate, unrestricted
"any account, no exceptions" reset-password/delete-account power that
served as an escape hatch for exactly this kind of lockout; that power was
removed 2026-08-13 (Nader, same day as this split) — see "Forgotten
passwords are admin/super_admin-assisted, not self-service" below for why,
and for the lockout gap removing it reopens: nothing can reset or delete
the sole `super_admin` account if it's ever locked out (the super_admin
itself can't self-target reset-password/delete-account either, same as an
admin already can't self-target). `GET /auth/accounts` is filtered
server-side to each actor's
manageable-roles set, not just hidden in the UI — same need-to-know
philosophy `request.routes.js`'s redaction rules use elsewhere in this app.
The frontend reuses one component, `AdminDashboard.jsx`, for both
`/admin` and `/super-admin` (routed separately, gated by `RequireRole`
same as every other dashboard) — nearly everything is shared UI (the
account table, the create form, reset/delete), the only difference is which
roles the create-form dropdown offers, driven by `user.role`.

A brand-new deployment has no accounts yet to create the first one, so a
database with zero accounts triggers an in-browser first-run setup flow
instead of a login form nobody could use yet (2026-08-13, Nader — replaced
an earlier design where `seed:final` auto-created a bootstrap admin with a
fixed default password, dropped specifically to avoid a well-known default
credential pair sitting in the codebase/docs waiting to be forgotten about
after a real deployment). `GET /auth/setup-status` (public, no auth) reports
`{ needsSetup: true }` whenever `User.count() === 0`; `Login.jsx` checks
this on mount and redirects straight to `/setup`
(`frontend/src/pages/FirstRunSetup.jsx`) before ever rendering the login
form. That page collects the new account holder's own real name, email,
landline, and a password THEY chose (not a generated default), submits to
`POST /auth/setup` (public, no auth, but re-checks `User.count() === 0`
server-side at request time and 409s permanently the instant any account
exists — this is the one place in the whole app an unauthenticated request
can create an account, so the guard is load-bearing, not cosmetic), and logs
straight into the new account via the same token/user response shape
`POST /auth/login` returns — "everything else flows like normal after
that." The account this route creates is a **`super_admin`, not a plain
`admin`** (changed the same day the role was split off) — it's the root of
the whole hierarchy, landing on `/super-admin` to create the first real
`admin`, who then creates every File Management/reviewer account from
`/admin` in turn. `npm run seed:final` now only ever upserts the 13
departments, same as before this feature existed; `npm run seed:dev` still
seeds an equivalent demo super_admin AND demo admin directly
(`superadmin@demo.local` / `admin@demo.local` — see
`backend/src/seed/demo-users.data.js`), since the demo dataset is never a
genuinely empty database this flow would trigger on anyway.
`GET /departments/coverage` (see "The most important business rules" below)
gained `missingAdmin` alongside its existing `missingFileManagement` for
the same reason — a deployment with a `super_admin` but zero `admin`
accounts is just as real a dead end (nobody could staff any department or
File Management) as one with zero File Management accounts already was.

**Forgotten passwords are admin/super_admin-assisted, not self-service**
(2026-08-11, extended to admins 2026-08-13, split by tier the same day once
`super_admin` was introduced, and IT's own unrestricted piece of this
removed entirely later that same day, Nader) — there's no email
infrastructure in this app to send a reset link through, and it's a small
enough internal team that this doesn't need one. An admin or super_admin
can issue a one-time password via `POST /auth/reset-password`,
re-authenticating with their own password first (same re-auth-to-confirm
pattern used everywhere else), scoped to what `MANAGEABLE_ROLES_BY_ACTOR`
lets them manage (see above): an admin can reset a File Management/reviewer
account (an IT reviewer included — IT is an ordinary reviewer account for
this purpose, see below) but NOT another admin or the super_admin; a
super_admin can reset an admin account but NOT a File Management/reviewer
account (and not another super_admin — there isn't one, and it can't
create one). The plaintext one-time password is returned once, for the
acting user to hand off directly (phone call, in person) — never emailed,
never stored anywhere but the account's (temporary) `passwordHash`. That
account's `mustResetPassword` flips to `true`, which `requireAuth`
(`backend/src/middleware/auth.middleware.js`) enforces server-side, not
just cosmetically: a token minted from a one-time password can hit exactly
one route, `POST /auth/set-new-password` (re-auth with the one-time
password, pick a real one), until that succeeds. So a locked-out person
actually knows who to ask, the login page has a "Forgot your password?"
disclosure listing every admin/super_admin's name, email, and landline,
backed by `GET /auth/admin-contacts` — deliberately public/no-auth, same
"public by necessity" reasoning as `GET /api/departments`, since someone
locked out by definition has no token yet. The same tier-scoped pairing
applies to `POST /auth/delete-account` (permanently delete an account within
what the acting user's tier manages — NOT the acting user's own account,
since neither `admin` nor `super_admin` ever appears in its own
`MANAGEABLE_ROLES_BY_ACTOR` entry, same self-target block described above;
no restrictions beyond that scoping, that's judged the acting user's call to
make, not something the route gates further).

**IT lost its separate, unrestricted "any account, no exceptions"
reset-password/delete-account power on 2026-08-13 (Nader)** — until then,
any of IT's 5 reviewers could reset or delete literally any account
(another IT reviewer, a plain department reviewer, File Management, an
admin, or a super_admin), predating admin/super_admin accounts entirely and
serving as the one deliberate escape hatch if a whole account tier got
locked out. That power is gone: both routes now check ONLY
`MANAGEABLE_ROLES_BY_ACTOR`, so an IT reviewer is just an ordinary
`reviewer` account for this purpose, manageable by an admin exactly like
any other reviewer, and unable to reset or delete anyone else's account,
including another IT reviewer's. `ReviewerDashboard.jsx`'s IT-only
"Reset a colleague's password" / "Delete an account" panels were removed
along with the routes' IT bypass (there's nothing left for them to call);
`Login.jsx`'s "Forgot your password?" disclosure now points at
`GET /auth/admin-contacts` instead of `GET /auth/it-contacts` for the same
reason — IT can no longer actually help with a forgotten password, an
admin/super_admin can. `GET /auth/it-contacts` still exists and is still
shown alongside admin contacts in the login page's "Need help?" widget
(`SupportModal.jsx`) — IT remains a legitimate general contact point (e.g.
for issues with the clearance process itself), just not for account
resets/deletions anymore. This intentionally reopens a lockout gap that
used to be closed: if the sole `super_admin` account is ever locked out,
there is now no account of any kind that can reset or delete it (see the
`super_admin` paragraph above) — accepted as a tradeoff of this change, not
an oversight.

Employees being cleared never log in and are not stored anywhere ahead of
time — File Management types their data directly into the create-request
form (see "What's on a clearance request" below). There used to be a mock
`Employee` directory File Management searched; it's gone, along with
`GET /api/employees/search` and `EmployeePicker.jsx`.

Once every one of the 13 departments has signed (see point 5 below for why
that's still not the same as "completed"), any of IT's 5 reviewers can
trigger `POST /:id/revoke-access` (re-authenticates with their own password,
no file) which sets `accessRevoked: true` on the request. This app is a
coordination bridge between File Management and the other departments, not a
system of record for Active Directory itself — it never actually disables
anything. IT does the real revocation elsewhere and this route just records
that they've told File Management it's done. The "temporary database" idea
floated in the original brief was considered and dropped (2026-08-10,
Nader): there's no separate archival/deletion step for cleared employees'
data, the `accessRevoked`/`status: "completed"` flags on the request ARE the
final design, not a placeholder.

## The most important business rules

The real 13 departments, in the paper form's row order (see
`backend/src/seed/departments.data.js` for exact keys):

1. الكسب غير مشروع, 2. أ.ع المكتبة, 3. الأمن, 4. الشئون القانونية,
5. أ.ع الشئون الطبية والعلاجية, 6. أ.ع حسابات الرعاية الصحية,
7. تنمية الموارد البشرية, 8. العلاقات العامة وخدمات الإجتماعية, 9. المخازن,
10. نظم المعلومات والاتصالات (IT), 11. خدمات النقل, 12. الأجور والاستحقاقات
(oversight), 13. الشئون المالية (oversight).

Everything below is enforced in `backend/src/routes/request.routes.js`, and
ONLY there:

1. **Tier-based locking, not a strict 1-through-13 chain.** `Department.tier`
   (1 for departments 1–11 incl. IT, 2 for Wages/Finance) drives
   `isDepartmentUnlocked()` (a small helper at the top of the file): a
   department is locked until every department with a LOWER tier has
   `status: "completed"`. Tier-1 departments have nothing below them, so they
   sign in parallel — this is a deliberate change (2026-08-03) from the
   original fully-sequential design. Add more tiers later by editing seed
   data only, nothing here.
2. **Two signature modes, config-driven per department
   (`Department.signatureMode`), never hardcoded by key:**
   - `"single"` (12 of 13 departments): any ONE reviewer account assigned to
     that department can sign it — one action, no checklist items.
   - `"itemized"` (IT only): 5 checklist items, each permanently owned by one
     specific reviewer account (`User.assignedItemKey` must match the item's
     `key`). The department completes once all 5 items are signed.
3. **"Signing" is re-authentication + evidence upload, not a checkbox.** Both
   sign routes (`POST .../departments/:deptKey/sign` and
   `POST .../departments/:deptKey/items/:itemKey/sign`) require the
   currently-logged-in reviewer's own password (bcrypt-verified again, same
   identity as the JWT — not a kiosk/shared-login model) plus a
   `multipart/form-data` photo or PDF of the physical signature/stamp,
   captured fresh per request via `multer` (`backend/uploads/<requestId>/...`,
   gitignored). There is no separate "finalize" step and no reject/hold flow
   — a department is either unsigned or signed. Either state is reversible
   though: `POST .../departments/:deptKey/reopen` (and the itemized
   `.../items/:itemKey/reopen`) resets a signed department/item back to
   unsigned, clearing its evidence — callable either by File Management (on
   any request in its shared queue) or by the signing department's own
   reviewers
     undoing their own mistake (any account from a single-mode department,
     or for an itemized item, only the one reviewer it's assigned
   to — same ownership rule as signing itself). Blocked once the request's
   access has been revoked (point 5) — that really is final.
4. **Visibility is need-to-know, enforced server-side, not just hidden in the
   UI:**
   - A plain reviewer's `GET /requests` / `GET /requests/:id` response is
     redacted to ONLY their own department's entry (`redactToOwnDepartment()`)
     — they never see whether other departments have signed. This is every
     request ever unlocked for their department, not just currently-pending
     ones (a real dashboard, not a bare to-do queue), with a `needsAction`
     flag on that entry so the frontend can bucket "waiting on you" vs
     "already signed" without re-deriving the rule. That one entry isn't
     further stripped, though — it still carries its own evidence, so
     `GET .../evidence/:deptKey` already allowed any of that department's
     reviewers to fetch it (`req.user.departmentKey === req.params.deptKey`);
     `SignaturePanel.jsx` now actually shows that preview once signed,
     alongside the signer/date and the Undo control, via the same
     `EvidencePreview` component `RequestOversightGrid.jsx` uses.
   - Wages/Finance reviewers (`Department.hasOversightDashboard`, embedded in
     the JWT at login so route logic never hardcodes those two keys) get the
     full, un-redacted request — every department's status, signer, and
     evidence — via `canSeeFull()`.
   - File Management gets neither of the above reviewer views, but as of
     2026-08-11 its curated shape (`summarizeForFileManagement()`) carries
     the same signer detail oversight sees: name, sign date, email
     (`signedByUserID`), and landline (`signedByLandlineNumber`) per
     department/item, so File Management can actually contact a reviewer
     about a problem signature instead of just seeing that "something" is
     signed. Every File Management account sees the same organizational
     request queue, while `createdByUserID` remains an audit field recording
     who filed it. The one remaining structural difference from oversight is
     shape, not information: `summarizeForFileManagement()` still hand-picks
     fields onto a curated object rather than returning the raw department
     array `withOwnDepartmentAnnotated()` does. Evidence itself is included
     the moment a department's own `status` is `"completed"`, same as
     oversight sees it — not gated on File Management's own approval below.
     This is what lets File Management actually spot an illegible signature
     and reopen it (see the `.../reopen` and `.../items/:itemKey/reopen`
     routes — password re-auth, resets that department/item back to
     `"pending"`, clears its evidence, and revokes `fileManagementApproved`
     if it had already been given) before approving the clearance, not just
     after. They can also preview/download the composited PDF for any
     request once every department has signed (`allDepartmentsSigned()`,
     same condition as below — not gated on `status === "completed"`, which
     would make it unreachable until after IT's own final step).
5. **"Revoke access" is the real final step, not a formality after the
   fact — `request.status` only becomes `"completed"` once IT has done it.**
   This is a general rule, not IT-specific busywork: an employee being "fully
   signed" and an employee being "cleared" are different things.
   `allDepartmentsSigned()` (every one of the 13 `status === "completed"`) is
   necessary but not sufficient — `computeOverallStatus()` also requires
   `accessRevoked === true`. Concretely: the sign routes can only ever
   recompute `status` back to `"in_progress"`; `POST /:id/revoke-access` is
   the ONLY route that can set it to `"completed"`, and it flips
   `accessRevoked`/`completedAt` at the same time. Getting there also
   requires a second, independent gate: File Management must explicitly
   `POST /:id/approve-clearance` (their own password re-auth) once
   `allDepartmentsSigned()` — this is the human checkpoint where they're
   expected to have already reviewed every department's evidence (see point
   4) and reopened anything illegible. `revoke-access` itself checks
   `allDepartmentsSigned() && fileManagementApproved`, not
   `status === "completed"` — the latter would be circular, since `status`
   can't reach `"completed"` any other way. Only IT reviewers
   (`departmentKey === "it"`) can call revoke-access — independent of IT's
   own position (#10) in the order — and any of its 5 can trigger it. Since
   `status` alone can't tell IT "all 13 have signed and File Management
   approved" without IT also seeing every other department's detail, every
   reviewer-facing response carries `readyForAccessRevocation` (both
   conditions true) and `awaitingFileManagementApproval` (signed but not yet
   approved) — computed from the full departments array before redaction — so IT's
   "Revoke access" button knows when to appear without ever being told which
   specific other departments are done. IT's OWN `needsAction` flag
   (`redactToOwnDepartment()`) has a second OR-branch for this too
   (`itAwaitingRevocation`, 2026-08-11): once IT's own item/department is
   signed, the generic `isPendingForReviewer()` check flips to false even
   though the revoke-access action is still outstanding and isn't tied to any
   one reviewer's assigned item — without the extra branch, a fully-signed,
   FM-approved request quietly reads as "already handled" and drops off IT's
   own dashboard instead of showing as something to act on.
   User-facing wording split (2026-08-11, Nader): IT's own revoke-access
   button/hint/busy-label/banner and their own request-list badge for this
   state are worded around "Active Directory" specifically (`reviewer.
   revokeAccessButton` etc., blue `.status-pill.awaiting-ad`) since that's IT's
   actual real-world action; everyone else (File Management's approve step,
   oversight's badges, the shared `RequestOversightGrid` banner) keeps the
   original generic "access/permissions" wording — same underlying
   `readyForAccessRevocation`/`accessRevoked` fields throughout, this is
   presentation-only, scoped to strings that were already exclusively
   IT-facing.
6. **File Management can permanently delete a FULLY COMPLETED request,
   irreversibly** (`POST /:id/delete`, requires `status === "completed"`,
   2026-08-11) — e.g. the employee came back to the company after already
   being fully cleared and access-revoked, and the record shouldn't keep
   reading as "completed" for someone actively working again. This is for
   reverting a finalized clearance decision specifically, not a general
   "cancel any request" tool — a request still mid-flight (signed but not
   yet fully revoked) can't be deleted this way, only reopened. Real hard
   delete: the `clearance_requests` row (its `request_departments`/
   `request_items` children cascade with it via the foreign key) AND its
   `backend/uploads/<requestId>/` evidence directory are both removed, no
   soft-delete/archive flag anywhere in this schema, no undo. Password re-auth like every other consequential
   action here; any File Management account, not just the request's
   creator, same rule as reopen.

If you need to change any of this logic, it lives in exactly one place. Don't
duplicate it in the frontend beyond the UX hints in `SignaturePanel.jsx`
(showing/hiding the sign form, the "your item" tag) — the frontend checks
there are cosmetic; the backend is the source of truth.

## Compositing signatures onto the paper form

`backend/src/services/clearancePdf.js` loads
`backend/assets/clearance-form-template.pdf` and, for each department that has
signed, draws its uploaded evidence photo into that department's row
(hand-calibrated coordinates — one table-top offset + one row height, keyed by
`ClearanceRequest.departments[].order` — see the comment at the top of that
file for how to re-derive both if this template is ever replaced again;
deriving every row from a per-row eyeball estimate drifted about half a row
off by row 13 on the original scanned version, so don't go back to that
approach) plus the signer's name and date. Both image evidence (jpg/png) and
PDF evidence get embedded — PDF is actually the common case in practice, more
so than a phone photo — and both go through the same pipeline so they blend
in the same way: decoded to raw RGBA pixels, then near-white background
pixels are made transparent (`stripNearWhiteBackground()`, soft-edged near
the threshold so ink strokes don't get a jagged cutout) — a real signature
(photographed on paper, or a scanned/exported PDF page) has a white/off-white
background, and without this it would composite as a visible opaque
rectangle stamped over the printed form instead of blending in. Images
decode directly (`pngjs`/`jpeg-js`); a PDF's first page is rasterized first
(`pdfjs-dist` + `@napi-rs/canvas`, `rasterizePdfPage()` in
`clearancePdf.js`) so it can go through the exact same treatment rather than
being embedded as an untouched vector block. Before the white-strip step,
`cropToContent()` also trims the decoded pixels down to the bounding box of
non-near-white content (small margin kept) — without this, evidence that's a
whole scanned/exported page with the actual ink occupying only a small
portion of it (an A4 PDF export being the common shape here) would scale
down to an illegible sliver once the page's own empty margin has to shrink
along with it to fit the signature cell; cropping first means only the
signature itself gets sized to fill the cell, regardless of how much blank
page surrounds it in the original upload. Evidence uploads are restricted to
jpg/png/pdf (see the multer `fileFilter` in `request.routes.js`) — webp was
dropped from the allowlist (2026-08-10) rather than adding a fourth decoder,
since real usage is always a phone photo or an exported/scanned PDF and webp
wasn't expected to ever actually show up.
`GET /requests/:id/pdf` generates this on demand — a partial preview while
in progress, the final artifact once `status === "completed"`.

The paper form actually has a third column per row, "البيان" (statement),
to the right of "التوقيع" — until 2026-08-11 deliberately left blank; every
signed row now gets a fixed "خالي الطرف" stamp there so the form reads as
complete rather than leaving that cell empty next to a real signature.
`COLUMNS.statement` was derived the same way as `name`/`signature` (render
the template at 300 DPI, find the vertical grid lines flanking it — see the
coordinate-derivation comment at the top of `clearancePdf.js`). This needed
an actual Arabic-capable font: `StandardFonts.Helvetica` (used for the
"الاسم" column) has no Arabic glyphs at all, and pdf-lib's standard-font
text-drawing path doesn't shape Arabic contextual letterforms even where a
font does have the glyphs. `backend/assets/cairo-arabic.ttf` — the same
Cairo family the frontend uses, decompressed once from
`frontend/public/fonts/cairo-var-arabic.woff2` via the `wawoff2` package
(pdf-lib/fontkit couldn't parse the woff2 container directly for embedding,
even though fontkit reads it fine for other purposes) — embedded through
`@pdf-lib/fontkit` (`pdfDoc.registerFontkit()`), which *does* shape Arabic
correctly when drawing through a custom embedded font. Scoped narrowly: only
the fixed "خالي الطرف" string uses this font; the "الاسم" column's
Helvetica-based drawing is untouched, so a reviewer's Arabic `fullName`
would still fail there — a pre-existing gap this didn't set out to fix.

## What's on a clearance request

Besides the per-department signature snapshot, `ClearanceRequest` stores why
the employee is leaving (`reason`: one of 13 HR-provided categories — see
`LEAVING_REASONS` in `ClearanceRequest.js` and the matching `REASONS` +
i18n keys in `frontend/src/utils/leavingReason.js`; "retirement" is Egypt's
mandatory age-60 policy, referred to as "المعاش", distinct from the
voluntary "early_retirement" / "معاش مبكر") and their `lastWorkingDay`. The
employee's job title (`employeeJobTitle`) is picked from a fixed company
title list (`frontend/src/jobTitles.js`, HR-provided, Arabic-only regardless
of UI language) via a searchable `<input list>`/`<datalist>`, not free text.
File Management enters all of this directly —
`employeeNumber`, `employeeFullName`, `employeeJobTitle`,
`employeeDepartment_ar/en`, `reason`, `lastWorkingDay` — on the
create-request form (`POST /requests`, validated there); NOT by the employee,
who never interacts with the system, and not looked up from any directory
(there isn't one — see "admin-managed accounts, no AD" above). Since it's
typed fresh per request rather than snapshotted from a stored record, there's
no drift concern to design around here the way the department-list snapshot
below has.

## Roles

- `file_management`: files requests on an employee's behalf (`POST /requests`,
  typing in the employee's data directly), sees a high-level status summary
  of every request in the shared File Management queue, and downloads the
  final signed PDF once complete. Can review department evidence and see
  each signer's identity + contact info (name, sign date, email, landline)
  to follow up directly on a problem signature.
- `reviewer`: tied to one `departmentKey`. Any reviewer can sign their
  department (or, for IT, their one assigned item) once it's unlocked.
  Reviewers whose department has `hasOversightDashboard: true` (Wages,
  Finance) additionally get the full 13-department status grid for every
  request, not just their own.
- `admin`: manages File Management and reviewer accounts and nothing else —
  `AdminDashboard.jsx` (routed at `/admin`) lists every such account,
  creates new ones (`file_management` or `reviewer`), and can reset a
  password or permanently delete one. Cannot create, list, reset, or delete
  another `admin` or a `super_admin` account (see `MANAGEABLE_ROLES_BY_ACTOR`
  above). Not tied to a `departmentKey`, never appears in any
  clearance-request route (`request.routes.js`'s role checks never include
  `"admin"`, so an admin token 403s there same as any other role that isn't
  `file_management`/`reviewer`) — this role exists solely for point 1 below,
  it has no visibility into or action on clearance requests themselves.
- `super_admin`: manages `admin` accounts and nothing else — the exact same
  job `admin` does, one tier up. Reuses the same `AdminDashboard.jsx`
  component (routed at `/super-admin`), just scoped to admin accounts
  instead of File Management/reviewer ones. There is exactly ONE
  `super_admin` account, ever — it cannot create another one (`role:
  "super_admin"` never appears in any actor's `MANAGEABLE_ROLES_BY_ACTOR`
  entry, including its own). Cannot create a File Management or reviewer
  account directly, and like `admin`, never appears in any clearance-request
  route.

Account provisioning is admin/super_admin-managed, no sign-up — see
"admin-managed accounts, no AD" above for the one integrity rule (IT item
uniqueness) that's actually enforced, the admin/super_admin tier split, and
for how a brand-new deployment bootstraps its first (super_admin) account.

## Commands

Backend:
```
cd backend
npm install
cp .env.example .env     # then point DATABASE_URL at your local PostgreSQL
npm run seed:dev           # upserts demo/reference data and replaces 5 fixed demo requests
npm run dev                # nodemon, http://localhost:4000
node scripts/smoke-test.js # exercises the full flow, admin-provisioning its own throwaway accounts
```

Frontend:
```
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to localhost:4000
```

`npm run seed:dev` upserts a deterministic demo account set (now including
one demo admin, `admin@demo.local`) and replaces the five fixed demo
requests without deleting unrelated accounts/requests created since. All
demo accounts use `DemoPassw0rd!`; see `backend/src/seed/demo-users.data.js`
for the complete login list. New File Management/reviewer accounts are
created by logging in as an admin and using `/admin`; new admin accounts by
logging in as a super_admin and using `/super-admin` — there's no
`/register` page anymore.

For a real (non-demo) deployment, run `npm run seed:final` instead — it
upserts only the 13 real departments (`backend/src/seed/upsertDepartments.js`,
shared with `seed:dev`) and creates no accounts, requests, or evidence
files. Visiting the site with zero accounts in the database triggers the
in-browser first-run setup flow (see "admin-managed accounts, no AD" above)
— fill in that first person's own real name, email, landline, and password
there, and it creates them as a `super_admin`, logging straight into
`/super-admin` to create the first real `admin` account, who then creates
every File Management/reviewer account from `/admin` in turn. `npm run
seed:local`/root `npm run dev:local` spin up a throwaway local PostgreSQL
via Docker (`egas-postgres` container) for offline dev.

`npm run seed:final:reset-users` (`node src/seed/seedDepartments.js
--reset-users`) is the same department upsert, plus wiping every row out of
`users` first. It's local/dev-only, to force the first-run setup flow back
up on a database that already has accounts, without dropping the whole DB —
deliberately NOT what plain `npm run seed:final` does, since that command is
documented above as safe to rerun against a real deployment; unconditionally
deleting accounts there would mean rerunning it later against a live
instance (e.g. to pick up a department-data tweak) wipes out every real
admin/reviewer account that exists by then.

**Deployment target (decided 2026-08-10):** a company-controlled Windows
Server running a local PostgreSQL instance (MongoDB through 2026-08-11, see
"Data layer" above) — `DATABASE_URL` in `.env` needs to point at that local
instance at deploy time. Given the small trusted user base and internal-only
network, this repo deliberately has no CI pipeline, rate limiting, or
automated test suite beyond `scripts/smoke-test.js` — that's judged
sufficient for a single hand-deployed instance, not a gap to fill later.

## Working conventions for this repo

- Keep the backend and frontend fully decoupled — the frontend only ever talks to
  the backend over `/api/*` HTTP endpoints, never imports backend code directly.
- New department-specific logic belongs in data (`departments.data.js` — e.g.
  `tier`, `signatureMode`, `hasOversightDashboard`), not in new branches of
  `if (deptKey === "...")` in route handlers. If you find yourself writing
  that, stop and reconsider the schema instead. (The one intentional
  exception is the `revoke-access` route, which checks `departmentKey === "it"`
  directly — that's inherent to IT's identity as the access-revocation actor,
  not a checklist template detail.)
- Wrap async route handlers in `asyncHandler` (`backend/src/utils/asyncHandler.js`).
  Express 4 does not catch rejected promises from async handlers on its own —
  an uncaught error (bad input, a corrupt uploaded file, a DB hiccup) becomes
  an unhandled rejection and crashes the whole process, not just that request.
- Every non-trivial change: update `PROJECT_STATUS.md` (move the task, note
  blockers) so the whole team can see progress without asking in the group chat.
- Arabic is the default UI language (`localStorage` lang defaults to `"ar"` in
  `frontend/src/i18n.js`). Always add both `label_ar`/`label_en` (or `_ar`/`_en`)
  when adding user-facing strings — never ship Arabic-only or English-only text.
- Commit small. This is a from-scratch team; large multi-feature commits are hard
  to review and hard to unwind if something's wrong.
