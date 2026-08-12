# Project Status

Last updated: 2026-08-12 (migrated the entire data layer from
MongoDB/Mongoose to PostgreSQL/Sequelize, on a new `postgres-migration`
branch — by Nader + Claude). Update this file whenever a task moves — don't
let it go stale.

## Done

- [x] **Migrated the data layer from MongoDB/Mongoose to PostgreSQL/Sequelize
      (2026-08-12), on a new `postgres-migration` branch (not yet merged to
      `main`).** A full rewrite of every model, all three route files' data
      access, and the seed scripts — see the new "Data layer: PostgreSQL via
      Sequelize" section in `CLAUDE.md` for the schema design and, more
      importantly, the compatibility-shim strategy that made this tractable:
      `backend/src/services/requestAssembly.js` reconstructs the exact
      plain-object shape (`_id`, nested `departments[].items[]`, a
      `evidence: {...}|null` object) Mongoose's `.toObject()` used to
      produce, so every pure business-logic function in `request.routes.js`
      (tier-locking, redaction, `computeOverallStatus`, etc.) and
      `clearancePdf.js`'s PDF compositing needed **zero changes** — they
      only ever touched plain objects, never Mongoose documents directly.
      New schema: `departments`/`department_checklist_items` (Department's
      template `key` stays the natural primary key), `users` (`userID`/email
      stays the PK), `clearance_requests` (new UUID PK, replacing Mongo's
      ObjectId) with child tables `request_departments`/`request_items`
      replacing the old embedded arrays. No migrations directory --
      `config/db.js` calls `sequelize.sync({ alter: true })` at startup,
      matching Mongoose's old implicit-collection-creation convenience and
      this repo's existing no-CI-pipeline philosophy. `DATABASE_URL`
      replaces `MONGO_URI` in `.env`; `seed:local`/root `dev:local` now spin
      up a Docker Postgres (`egas-postgres`) instead of Mongo.
      Verified thoroughly given the size of this rewrite: `npm run seed:dev`
      passes its own `verifyDemoSeed()` checks against a real local
      Postgres; the FULL `backend/scripts/smoke-test.js` suite passes
      end-to-end (tier locking, single/itemized signing, self-undo,
      cross-department 403s, evidence visibility, approve-clearance,
      revoke-access, redaction, the whole password-reset flow); manually
      verified the permanent-delete route (row + cascaded children + evidence
      directory all gone, confirmed via a direct DB count); downloaded a real
      composited PDF from Postgres-backed data and confirmed all 13 rows
      render correctly (signatures, signer names, "خالي الطرف" stamps); and
      drove the actual frontend against the Postgres-backed API
      (Playwright) — request list, status badges, and the full expanded
      detail view for a 13-department request all render identically to the
      Mongo-era app. `npm run build` clean. Frontend code is completely
      unchanged -- this was a backend/database-only migration.

- [x] **IT-assisted password reset via a one-time password (2026-08-11).**
      No email infrastructure exists in this app to send a reset link
      through, and the team decided that's not worth adding for this small a
      user base — instead, any of IT's 5 reviewers can issue ANY account
      (another IT reviewer, a plain department reviewer, or File Management)
      a fresh one-time password (`POST /auth/reset-password`, IT's own
      password re-auth required first). `User.mustResetPassword` flips to
      `true`; `requireAuth` (`backend/src/middleware/auth.middleware.js`)
      enforces server-side that a token minted from a one-time-password login
      can reach exactly one route -- `POST /auth/set-new-password` -- until
      the person sets a real password there (re-authenticating with the
      one-time password first, same pattern as every other sensitive action
      in this app). Frontend: new `frontend/src/pages/SetNewPassword.jsx`,
      routed at `/set-new-password` and enforced as a hard redirect in
      `App.jsx`'s `RequireRole`/`Home` whenever `user.mustResetPassword` is
      true; a new IT-only "Reset a colleague's password" panel
      (`ResetPasswordPanel` in `ReviewerDashboard.jsx`) shows the generated
      one-time password once, to hand off directly (phone call, in person).
      Verified end to end: full `backend/scripts/smoke-test.js` run (now
      covering the whole flow -- issuing a one-time password, the old
      password breaking, the 403 lockout on every other route, wrong-OTP and
      weak-new-password rejections, and the fresh token working normally
      after success) passing against a local MongoDB (the shared Atlas dev
      cluster was briefly unreachable, unrelated to this change -- see
      `npm run dev:local`/`seed:local` for the Docker-based local fallback),
      plus a clean production frontend build.
      Follow-up the same day: the login page now has a "Forgot your
      password?" disclosure (styled like the existing demo-accounts one)
      listing every IT reviewer's name, email, and landline, so someone
      locked out actually knows who to contact instead of just being told
      to "ask IT". Backed by a new `GET /auth/it-contacts` -- deliberately
      PUBLIC/no-auth, same reasoning as `GET /api/departments`, since a
      locked-out person by definition has no token to authenticate with.
      Returns only `fullName`/`fullName_ar`/`userID`/`landlineNumber` for
      `departmentKey: "it"` users (no `passwordHash`, no `_id`). Verified
      live in-browser in both languages: opened the disclosure, confirmed
      all 5 IT reviewers list with correct `mailto:`/`tel:` links.

- [x] Repo scaffolded: `backend/` (Express + Mongoose) and `frontend/` (React + Vite).
- [x] Mock Active Directory (`User` model) + JWT login (`/api/auth/login`).
- [x] `Department` model with configurable, ordered `checklistItems` per department.
- [x] `ClearanceRequest` model that snapshots department templates on submit.
- [x] Core workflow endpoint (`PATCH /requests/:id/departments/:deptKey/items/:itemKey`)
      enforcing: (1) items checked in order within a department, (2) a
      `isFinal` department's last item blocked until every other department
      is completed.
- [x] Seed data: all 13 departments (real names, confirmed complete), IT's
      exact 9-step ordered checklist, generic single-item placeholder for the
      other 12, 16 mock AD users (2 employees — `sara.employee` fresh,
      `mohamed.retiring` demo-ready with everything but IT done — 1 admin, 1
      reviewer per department).
- [x] Frontend: login, employee dashboard (submit + status grid), reviewer
      dashboard (pending list + checklist check-off), Arabic/English toggle
      with RTL, defaults to Arabic.
- [x] Verified: backend syntax/module loading, seed-data structural integrity
      (unique keys, clean ordering, exactly one `isFinal` department, full
      reviewer coverage), and frontend production build — all pass.
- [x] Shared MongoDB Atlas cluster set up and confirmed working — login,
      request submission, department check-off, and the IT order/final-gate
      rule all verified live end to end (both backend and frontend running
      against it).
- [x] **Fixed the admin department-picker bug** in `ReviewerDashboard.jsx`
      (was in "Known bugs" below). Admins now get a picker screen (department
      name + status badge, one button per department) between the request
      list and the checklist instead of always landing on Security. Reviewers
      are unaffected — their active department is still always
      `user.departmentKey`.
- [x] **Fixed MongoDB Atlas connection failures caused by local DNS.**
      `backend/src/server.js` now points Node's DNS resolver at `8.8.8.8` /
      `1.1.1.1` before connecting, because some local networks' default
      resolvers were dropping the TXT/SRV lookups `mongodb+srv://` needs
      (`queryTxt ETIMEOUT`) even though plain A-record lookups worked fine.
- [x] **Employee dashboard now shows a horizontal progress bar** instead of a
      status table — one step per department in order, turning green with a
      ✓ once that department's `status` is `completed`. Works in both LTR and
      RTL (Arabic renders it right-to-left automatically via the existing
      `dir` attribute).
- [x] **Added a demo-ready seeded account, `mohamed.retiring`.** Its request
      (created by `backend/src/seed/seed.js`) has all 12 non-IT departments
      already completed and IT untouched, so Monday's demo can go straight to
      showing the IT-must-be-last gate without clicking through every other
      department live. Log in as `it.reviewer` to work that request's
      checklist.
- [x] **Added a root-level `npm run dev`** (`concurrently`) that starts the
      backend and frontend together in one terminal with color-coded,
      prefixed output. Running each inside `backend/`/`frontend/` separately
      still works too.
- [x] **Redesigned the frontend visual style** to match EGAS's other internal
      app (the Travel Reimbursement System), reusing that org's real logo
      (`EGAS.png`) and login background image (both copied into
      `frontend/src/assets/`, same organization/owner, not a third party). New
      teal/green design system lives entirely in `frontend/src/styles.css`
      (CSS variables: `--green-700`, `--card`, `--line`, etc.) — login page,
      sticky app header with brand + logo, pill status badges, the progress
      stepper, checklist cards, and the language toggle (now a floating
      EN/عربي pill, bottom-corner, fixed on every page) were all restyled.
      Cairo (the existing bilingual variable font) was kept rather than
      switching to the other app's Inter/Tahoma split, since it already
      covers Arabic+Latin in one file. No backend, routing, or business-logic
      changes. Verified with `npm run build` (clean) and both dev servers
      running end to end against the shared Atlas cluster; could not get a
      headless browser screenshot in the sandbox environment used for this
      change (Playwright's Chromium download stalled), so a real visual
      pass in an actual browser is still worth doing before calling this done.
- [x] **Added a temporary "demo accounts" card to the login page**, listing
      all 15 seeded accounts (2 employees, admin, 13 department reviewers)
      with click-to-fill. Data lives in `frontend/src/demoAccounts.js`,
      explicitly commented as temporary and mirroring
      `backend/src/seed/users.data.js` / `departments.data.js` — delete that
      one file + its usage in `Login.jsx` once real accounts exist.
- [x] **Clearance requests now capture reason for leaving + suggested last
      working day.** `ClearanceRequest` gained `reason` (enum:
      `resignation` / `new_job` / `retirement` — "retirement" is Egypt's
      mandatory age-60 policy, "المعاش") and `lastWorkingDay` (`Date`).
      `POST /requests` validates both (reason must be one of the three
      values, date must parse and can't be in the past) — see
      `backend/src/models/ClearanceRequest.js` and
      `backend/src/routes/request.routes.js`. The employee's submission
      screen (`EmployeeDashboard.jsx`) is now a real form instead of a bare
      button. The request's `createdAt` (already free from Mongoose
      timestamps) plus reason/last-working-day are now surfaced to
      reviewers/admins via a `request-info` panel shown above every
      department's checklist and on the admin department-picker screen
      (`ReviewerDashboard.jsx`), and to the employee above their own
      progress grid. Did NOT add a department picker to the submission form
      — department already comes from the (mock) AD login, not user input,
      per the existing "mock AD" design.
- [x] **Redesigned the employee progress view as a non-scrolling icon grid.**
      Replaced the old horizontal-scroll step bar with a CSS grid
      (`.dept-progress-grid`) that wraps to fit all 13 departments on
      screen with no horizontal scrolling. Each department now shows one of
      three states purely from its position in the (already-ordered)
      department list: **done** (green, first N completed departments),
      **current** (gold/yellow, the first not-yet-completed one), **upcoming**
      (gray, everything after that). As of the sequential department gating
      change below, this now reflects real backend enforcement — "current"
      really is the one department currently actionable, not just a display
      simplification anymore (see below).
- [x] **Added a small hand-drawn icon per department** (shield for Security,
      scales for Legal, etc. — see `frontend/src/components/DepartmentIcon.jsx`,
      inline SVG, no new asset files/dependencies) shown on the employee
      progress grid, the admin department-picker list, and the reviewer's
      checklist header.
- [x] **A department can now reject a clearance request** instead of just
      leaving items unchecked, for when something's actually wrong (e.g. an
      outstanding item that can't be satisfied) rather than just "not done
      yet." `requestDepartmentSchema.status` gained a third value,
      `"rejected"`, plus `rejectedReason` / `rejectedBy` / `rejectedAt`.
      New endpoint: `PATCH /requests/:id/departments/:deptKey/reject`
      (`{ rejected: true, reason }` to reject — reason is required — or
      `{ rejected: false }` to clear it and let the department resume from
      whatever its checked items already imply). Rejecting a single
      department immediately flips the WHOLE request's `status` to
      `"rejected"` (`computeOverallStatus()` in `request.routes.js`,
      shared by both this route and the existing item-check route) — a
      rejection blocks clearance regardless of how far every other
      department got. While a department is rejected its checklist items
      are frozen (the item-check route now 409s) until the rejection is
      cleared, so `rejectedReason` can never go stale against a
      partially-changed checklist. Also fixed a related bug: the reviewer's
      "my pending requests" list (`GET /requests` as a reviewer) was
      filtering on `status: "pending"` only, which would have silently
      dropped a request the moment that reviewer rejected it — it now
      matches `pending` or `rejected` so the reviewer can still find it to
      clear later.
      On the frontend: `ChecklistPanel.jsx` gained a reject textarea +
      button (reviewer/admin) and a rejection banner (with a "clear
      rejection" button) when the department is already rejected; the
      employee's `EmployeeDashboard.jsx` shows a red alert box listing every
      rejected department and its reason, and that department's tile in the
      progress grid turns red with a ✕ instead of green/gold/gray.
- [x] **Departments now process strictly in order, not in parallel.** This is
      a deliberate change from the original "12 departments parallel + IT
      last" design (Nader's call, 2026-08-02) — a department is now locked
      until every department before it in the request's department order
      (i.e. `Department.order` at submission time, the same order the array
      was already snapshotted in) has fully completed. `isDepartmentUnlocked()`
      in `request.routes.js` is the one place this lives, replacing the old
      IT-only "last item blocked" special case — IT going last now falls out
      naturally from being last in the order, nothing IT-specific left in the
      code. A locked department: doesn't show up in that reviewer's `GET
      /requests` queue at all, 403s on direct `GET /requests/:id`, and 409s on
      both the item-check and reject routes. Admin's top-level request list is
      unaffected (admin still sees every request for oversight), but admin is
      NOT exempt from the lock when acting on a specific department — same as
      the old IT rule never exempted admin either. Frontend:
      `ChecklistPanel.jsx` shows a "waiting on earlier departments" banner and
      disables the whole checklist (not just checkboxes — also hides the
      reject form) when locked; admin's per-department picker list shows a
      "not started yet" badge for anything still locked. Updated
      `backend/scripts/smoke-test.js` to match (it used to check IT's items
      immediately after submission, which is no longer possible). Verified
      live end-to-end against the running dev servers: a locked department's
      queue is empty, direct ID access 403s, and it unlocks the moment the
      department before it completes.
- [x] **Checking every checklist item no longer auto-completes a department —
      finalizing now requires an explicit "Confirm" button.** New endpoint
      `PATCH /requests/:id/departments/:deptKey/finalize` is the only place
      `dept.status` becomes `"completed"` (400s if any item is still
      unchecked, 409s if rejected or still locked behind an earlier
      department — same guards as the item-check route). The item-check and
      reject/clear-rejection routes now only ever set a department back to
      `"pending"` (e.g. reopening one whose item got unchecked); they never
      set `"completed"` themselves anymore. The mock-AD archival side effect
      (`User.archivedFromAD`) moved from the item-check route to finalize,
      since that's the only route that can now actually complete a request.
      Frontend: `ChecklistPanel.jsx` shows a "Confirm department clearance"
      button once every item is checked, and a green "clearance confirmed"
      banner afterward instead of the checklist just silently locking in.
      Note IT's existing AD-deletion confirm dialog (on checking the very
      last item) is unrelated and unchanged — that still fires first, then
      the new finalize button is what actually completes IT's department.
      Updated `backend/scripts/smoke-test.js` (checking the last item no
      longer completes the request — finalize does) and verified the full
      flow live in-browser: check all 9 IT items (including the existing
      AD-deletion confirm), see the new "Confirm department clearance"
      button appear, click it, see the checklist freeze with a green
      confirmation banner.
- [x] **Reviewers now see the employee's actual EGAS department, not the
      clearance department they're already reviewing.** The request-info
      panel's "Department" field used to show `myDept.name_ar/en` — i.e.
      whichever of the 13 clearance departments' checklist you had open,
      which was redundant with the "Checklist for X" heading right below it.
      Added `User.employeeMeta.department_ar/en` (which EGAS department the
      employee actually works in — unrelated to the 13 clearance
      departments, though it can coincidentally share a name, e.g.
      `mohamed.retiring`'s is "General Administration of Warehouses", same
      as one of the clearance departments), threaded through the JWT payload
      (`auth.routes.js`) and snapshotted onto `ClearanceRequest` at
      submission (`employeeDepartment_ar/en`, same pattern as every other
      snapshotted field) so it doesn't drift if the employee's record
      changes later. `RequestInfo` now shows this on both the checklist view
      and admin's department-picker screen. Seeded both demo employees with
      real department names borrowed from `departments.data.js` (Sara →
      Financial Affairs, Mohamed → Warehouses). Verified live in-browser in
      both languages plus the admin picker screen.
- [x] **Full workflow revamp (2026-08-03) to match how the real paper process
      actually works**, based on the scanned "إخلاء طرف" form and a round of
      clarifying questions with Nader. This replaced most of the backend and
      frontend — see `CLAUDE.md` for the full design, this is a summary of
      what changed and why:
      - **Employees never log in anymore.** A new `file_management` role
        files every clearance request on the employee's behalf
        (`POST /requests`, after searching a new `Employee` mock-AD directory
        — `backend/src/models/Employee.js` — by number/name). The old
        `employee` role, `EmployeeDashboard.jsx`, and `GET /requests/mine`
        are gone.
      - **The real 13 departments and paper-form order replaced the old
        guessed 13** (`backend/src/seed/departments.data.js`) — e.g. IT is
        now #10, not last-by-convention; Wages (#12) and Financial Affairs
        (#13) are the real last two.
      - **Sequential-for-everyone locking became tier-based.** Departments
        1-11 (including IT) sign in parallel now; only Wages/Finance
        (`Department.tier: 2`) are gated behind all of 1-11. This replaced
        the 2026-08-02 "strictly in order" design entirely --
        `isDepartmentUnlocked()` in `request.routes.js` now checks tiers, not
        a full snapshot-order chain.
      - **Checkbox checklists became re-auth + evidence-upload signatures.**
        12 of 13 departments have no checklist at all anymore -- any one of
        that department's 2+ reviewer accounts signs once
        (`POST .../departments/:deptKey/sign`: re-enter your password +
        upload a photo/PDF of the physical signature/stamp, via `multer`).
        Only IT keeps itemized requirements, now 5 items (mobile+data lines,
        phone, PC/account/mailbox, SAP service, SAP account removal) instead
        of the old 9, each permanently owned by one of IT's 5 reviewer
        accounts (`User.assignedItemKey`). The old `finalize` and `reject`
        routes/UI are gone entirely -- no more "confirm" button, no more
        rejection/hold flow.
      - **Visibility is now enforced server-side, not just cosmetic.** A
        plain reviewer's API responses are redacted to their own department
        only (`redactToOwnDepartment()`); Wages/Finance reviewers get full
        per-department detail (`canSeeFull()`, driven by
        `Department.hasOversightDashboard`, never a hardcoded department
        key); File Management gets neither -- only a high-level status
        summary of requests they filed (`summarizeForFileManagement()`, no
        signer identity or evidence).
      - **"Delete from Active Directory" is now a manual capstone action**
        (`POST /:id/archive-ad`), shown on IT's dashboard only once ALL 13
        departments have signed -- independent of IT's position in the order.
        Flips `archivedFromAD` on the new `Employee` record (not `User`,
        since employees no longer have login records at all).
      - **New: composited signed PDF.** `backend/src/services/clearancePdf.js`
        (pdf-lib) overlays each department's uploaded evidence photo onto its
        row of `backend/assets/clearance-form-template.pdf` (the actual
        scanned form, hand-calibrated row coordinates). Downloadable via
        `GET /requests/:id/pdf` -- a live preview for oversight reviewers,
        the final artifact for File Management once a request is `completed`.
      - **Hardening found along the way:** Express 4 doesn't catch errors
        thrown inside async route handlers -- an uncaught one (hit live, via
        a corrupt test image crashing `pdf-lib`'s `embedPng`) becomes an
        unhandled promise rejection and kills the whole Node process, not
        just that request. Added `backend/src/utils/asyncHandler.js` and
        wrapped every async route handler with it, plus a try/catch around
        image embedding in `clearancePdf.js` so a bad upload just skips that
        row instead of taking down PDF generation. This was a latent risk in
        the original code too, just much more likely to trigger once file
        uploads and image parsing were introduced.
      - No more `admin` role -- nothing needed a true super-admin once File
        Management and oversight reviewers cover request creation and
        cross-department visibility. Account provisioning (which department
        a reviewer belongs to, which item an IT reviewer owns) stays
        seed-data-only, same mock-AD philosophy as before.
      - Verified end to end: rewrote `backend/scripts/smoke-test.js` to cover
        tier locking, single vs. itemized signing (including the
        wrong-reviewer-signs-wrong-item 403 case), the visibility redaction
        (a plain reviewer's response has exactly one department, no signer
        fields in File Management's view), AD deletion (and the
        can't-do-it-twice 409), and PDF access rules -- all passing against
        the shared Atlas cluster. Frontend production build (`npm run build`)
        also verified clean.
- [x] **Follow-up fixes after trying the revamp for real (2026-08-03):**
      - **Plain reviewers now get an actual dashboard, not a bare queue.**
        `GET /requests` for a non-oversight reviewer used to only return
        currently-pending items; it now returns every request ever unlocked
        for their department (pending AND already-signed), tagged with a
        `needsAction` flag (`isPendingForReviewer()` + a tier-unlock check,
        computed server-side so the frontend doesn't re-derive it).
        `ReviewerDashboard.jsx` shows stat tiles ("waiting on you" / "already
        signed") and buckets the list into two sections instead of one flat
        list with just an employee name. Same data now backs oversight
        reviewers' full-list view too (`withOwnDepartmentAnnotated()`).
      - **Fixed a real row-alignment bug in the composited PDF.** The
        per-row coordinates in `clearancePdf.js` were each hand-eyeballed
        independently and drifted about half a row off by row 13 (Financial
        Affairs' signature was landing in Wages' row). Re-derived from just
        the table's top edge + one row height instead — verified by
        overlaying debug rectangles on the actual scan at 300dpi and
        checking alignment at the top, middle, and bottom of the table.
      - **Signature evidence photos no longer composite as an opaque white
        box.** A real photo of a signature on paper has a white/off-white
        background; embedding it as-is stamped a visible rectangle over the
        printed form. Evidence is now decoded to raw pixels (new deps
        `pngjs`/`jpeg-js`) and near-white pixels are made transparent
        (soft-edged near the threshold, not a hard cutout) before embedding,
        regardless of upload format.
      - **Added a temporary dev-only "add employee" + "browse all
        employees" affordance** to `EmployeePicker.jsx` /
        `POST api/employees` / `GET /api/employees/search` (empty query now
        returns the whole directory instead of nothing) so testing doesn't
        require hand-editing `employees.data.js` and re-running the seed
        script. Clearly flagged for deletion once real AD/accounts exist,
        same as `demoAccounts.js`.
      - Also fixed two smaller bugs caught by actually driving the app in a
        browser: a `<form>` nested inside another `<form>` in
        `EmployeePicker.jsx` (invalid HTML), and `ReviewerDashboard.jsx`
        missing a loading state (briefly showed "no pending requests" before
        the real fetch resolved).
- [x] **Second round of follow-up fixes + department dashboards (2026-08-03):**
      - **Renamed `username` to `userID` everywhere** (mock-AD `User.userID`,
        JWT payload, login body/response, `createdByUserID`/
        `signedByUserID`/`archivedByUserID` on `ClearanceRequest`, login page
        copy in both languages). Required dropping the old MongoDB
        `username_1` unique index by hand (`User.syncIndexes()`) since
        Mongoose doesn't retire stale indexes from a field rename on its own
        — anyone pulling this change onto an existing local DB needs to run
        that once too, or just `npm run seed` against a fresh collection.
      - **Confirmed every non-IT department already has 2 reviewer seed
        accounts** (`users.data.js` was already correct here — no change
        needed).
      - **The composited PDF's name column now shows who signed, not who's
        being cleared.** `clearancePdf.js` was drawing
        `request.employeeFullName` on every row; it now draws that row's
        `signedByFullName` (or, for IT, the most recently-signed item's
        signer) — matches the paper form's "الاسم" column, which is a
        signer-name column, not a repeat of the employee's identity.
      - **The IT "Delete from Active Directory" button was reported missing.**
        Root-caused via a full re-auth + curl + live-browser walkthrough: the
        button's gating (`request.status === "completed"`, i.e. all 13
        departments including Wages/Finance) was already correct — the
        original report traced back to signing Wages/Finance before IT had
        actually finished all 5 items, which the tier lock correctly
        rejected. No code change was needed here; verified live in-browser
        that the button appears the moment the 13th department signs.
      - **The seeded demo request (#10567, Mohamed Farouk) now has real
        signature images**, not just a `status: "completed"` flag with no
        evidence. `seed.js` copies one of 3 sample signature PNGs
        (`backend/assets/dummy-signatures/`, copied from
        `frontend/src/assets/dummy-signature-*.png`) at random into each
        signed department's upload folder, and signs as that department's
        actual `reviewer1` seed account (not a synthetic `"seed-script"`
        identity) so both the dashboard and the composited PDF look like a
        real in-progress clearance.
      - **New: per-department analytics dashboard**
        (`frontend/src/components/DepartmentDashboard.jsx`), shown at the
        top of every reviewer's dashboard, computed entirely client-side from
        data `GET /requests` already returns (no new backend endpoints).
        Three flavors, all respecting the existing need-to-know visibility
        rule:
        - Plain tier-1 reviewers (and IT): stats scoped to requests that
          reached *their own* department only — total/pending/signed counts,
          avg. time-to-sign, reason-for-leaving breakdown, a 6-month trend,
          and recent activity. IT additionally gets a per-checklist-item
          completion breakdown (which of the 5 items tends to lag).
        - Wages/Finance (oversight): the same shape but aggregated across all
          13 departments and every request, plus department workload
          (pending count per department) and department performance
          (completion % per department) bars — matches their existing
          full-visibility `canSeeFull()` access, nothing new exposed.
        - Charts are plain CSS (conic-gradient donut, flexbox bar lists) —
          no new charting dependency.
      - Verified everything above live: reseeded, ran
        `backend/scripts/smoke-test.js` (still green), and drove the actual
        app with a headless browser (Playwright, installed temporarily as a
        frontend devDependency and removed afterward) through File
        Management → security reviewer → wages oversight → IT itemized
        signing → Delete-from-AD → composited PDF download, screenshotting
        each step.
- [x] **AD-deletion "final marker" + richer dashboards (2026-08-04):**
      - **A distinct "Deleted from AD" badge** (`.badge.archived`, new indigo
        color so it doesn't collide with the pending/completed palette) now
        shows wherever `request.archivedFromAD` is true: IT's own request
        list and recent-activity rows, and — new — `RequestOversightGrid`
        (shared by File Management's expanded row detail and the oversight
        full grid) gets a banner above the department list
        ("✓ this employee has been deleted from Active Directory · date").
        File Management's list row also gets the short badge next to the
        status pill. No backend change needed — `archivedFromAD` was already
        present on every response shape, just not surfaced in the UI.
      - **`DepartmentDashboard.jsx` gained more KPIs and a new chart, and
        File Management now gets the dashboard too** (previously only
        reviewers did): an "Overdue (7+ days)" tile (pending longer than a
        week) on every dashboard flavor; a "Deleted from AD" count tile on
        IT's, oversight's, and File Management's; and a new
        "Requests by employee's department" bar chart (grouping by
        `employeeDepartment_ar/en` — the employee's real EGAS department,
        not one of the 13 signing departments) on every flavor, closest
        analog to the reference screenshots' "Requests by Department" donut.
        File Management now renders the same company-wide dashboard
        oversight reviewers get (`computeCompanyStats`, reused as-is — their
        summarized request shape already carries everything that function
        needs: per-department `status`, `reason`, `createdAt`,
        `archivedFromAD`).
      - **Demo request re-shaped**: employee #10567 (Mohamed Farouk) now has
        all 11 tier-1 departments *including IT* fully signed (5/5 itemized
        items, each by its real owning reviewer) — only Wages and Finance
        (the paper form's last two rows) are left, so the demo goes straight
        to "unlock tier 2 → sign the last two → delete from AD" instead of
        needing to click through IT's 5 items live first.
      - Verified live: reseeded, smoke test green, and a full headless
        browser pass (Playwright, temporary devDependency again) — signed
        Wages then Finance as those reviewers, deleted from AD as IT, then
        confirmed the badge/marker renders correctly on IT's list, IT's
        dashboard KPI, File Management's list row, and File Management's
        expanded detail banner.
      - New demo employee **#10932 (Khaled Mostafa)**: all 13 departments
        already signed, nothing left but IT's "Delete from Active Directory"
        step. Refactored the seed script's request-building logic into a
        shared `buildDepartments()` helper (parameterized by which
        tiers/IT are pre-signed) instead of duplicating it per demo request.
- [x] **General rule: "fully signed" and "cleared" are different things
      (2026-08-04).** Every one of the 13 departments signing off used to be
      enough for `request.status` to read `"completed"` — Nader's call: it
      shouldn't. An employee isn't actually cleared until IT deletes them
      from Active Directory; that's the real final step, not a formality
      tacked on afterward. `computeOverallStatus()` in `request.routes.js`
      now requires BOTH `allDepartmentsSigned()` (new helper, factored out of
      the old check) AND `archivedFromAD === true`. Concretely: the two sign
      routes can now only ever recompute `status` back to `"in_progress"`;
      `POST /:id/archive-ad` became the ONLY route that can set it to
      `"completed"` (and now also sets `completedAt`, moved there from the
      sign routes). `archive-ad`'s own precondition flipped from
      `status === "completed"` to `allDepartmentsSigned()` — the old check
      would've been circular, since status could never reach `"completed"`
      any other way once this rule was in place.
      - **New problem this created**: IT's "Delete from Active Directory"
        button was gated on `status === "completed"` client-side — under the
        new rule that's now unreachable (chicken-and-egg). Fixed by adding a
        `readyForAdDeletion` boolean (`allDepartmentsSigned()` computed from
        the FULL departments array before it gets redacted down to just the
        reviewer's own entry) to every reviewer-facing response shape
        (`redactToOwnDepartment()`, `withOwnDepartmentAnnotated()`) — lets
        IT know "every department is done, you can delete now" without
        needing visibility into which specific other departments finished,
        preserving the existing need-to-know redaction. `ReviewerDashboard.jsx`
        now gates `ArchiveAdForm` on `selected.readyForAdDeletion`, not
        `selected.status`.
      - Fixed the #10932 (Khaled Mostafa) seed request from the entry above,
        which had been created with `status: "completed"` hardcoded — under
        the new rule that's wrong until AD deletion actually happens; removed
        the override so it now correctly shows `"in_progress"` with
        `readyForAdDeletion: true` until IT acts on it.
      - Updated `backend/scripts/smoke-test.js`: asserts `"in_progress"` (not
        `"completed"`) right after all 13 sign, that File Management's PDF
        download 403s at that point, that IT's view carries
        `readyForAdDeletion: true` without extra department detail, and that
        `status` only flips to `"completed"` in archive-ad's own response.
        All green.
- [x] **Made the "waiting on AD deletion" state visually obvious (2026-08-04).**
      The rule above made a real UX gap: a fully-signed request just read as
      generic "in progress" everywhere -- File Management's list badge, the
      oversight/File-Management detail grid, and even IT's own row inside
      that grid (which just said "Cleared" once its 5 items were signed,
      with zero hint anything else was needed). Fixed by exposing
      `readyForAdDeletion` on `summarizeForFileManagement()` too (it already
      existed for reviewers), then surfacing it in three places:
      - File Management's list row now shows a distinct gold
        "Awaiting AD deletion" badge instead of the generic "In progress"
        pill once every department has signed (a request still genuinely
        waiting on some department keeps the plain pill).
      - `RequestOversightGrid.jsx` (shared by File Management's expanded row
        and the oversight full grid) now shows a gold banner above the
        department list in that state: "Every department has signed --
        waiting on IT to delete this employee from Active Directory."
      - The IT row inside that same grid gets a small note under its
        "Cleared" badge: "Signed -- Active Directory deletion still
        pending" -- so it doesn't read as a dead end.
      Verified live in-browser (Playwright, temporary devDependency again):
      Khaled Mostafa's (#10932) request shows the new badge/banner/note in
      File Management's list and expanded view, and correctly does NOT show
      them for Mohamed Farouk's (#10567) request, which is still genuinely
      waiting on Wages/Finance, not IT.

- [x] **New paper-form template + live evidence previews (2026-08-04):**
      - **Replaced `backend/assets/clearance-form-template.pdf`** with a
        newer, cleaner source (a native Word-exported PDF, A4
        595.32x841.92pt -- not a scan, so its grid lines are real vector
        strokes rather than something to eyeball). Same 13 departments/order,
        same 5-column layout (م / الإدارة / البيان / التوقيع / الاسم), so no
        seed-data or schema changes needed. `clearancePdf.js`'s `TABLE_TOP`/
        `ROW_HEIGHT`/`COLUMNS` were re-derived to match (rendered at 300dpi,
        binarized, found the pixel rows/columns that are dark across nearly
        the whole table width/height -- grid lines are solid across a whole
        row/column, text isn't -- then converted to PDF points). One
        genuine oddity in the source table: row 7 ("تنمية الموارد البشرية")
        is a few points shorter than the other 12; used a uniform row height
        anyway (same reasoning as the previous template's calibration
        comment) rather than 13 separately-measured rows. Verified by
        generating a real composited PDF with dummy signature images across
        all 13 rows (including the itemized IT row) and visually confirming
        every name/photo lands inside its own row with no overlap.
      - **File Management and oversight (wages/finance) now see each
        department's uploaded evidence the moment that department signs**,
        not only after File Management's own approve-ad-deletion step. This
        was the actual point of the previously-existing
        `request.fileManagementApproved` gate on evidence in
        `summarizeForFileManagement()` / `GET /:id/evidence/...` /
        `RequestOversightGrid.jsx` -- since that approval itself requires
        every one of the 13 departments to already be signed
        (`allDepartmentsSigned()`), the gate meant evidence was only ever
        visible once the whole request was already done, which defeated the
        stated purpose of File Management using it to "check evidence
        legibility before approving" (see the approve-ad-deletion route's
        own comment). Removed the gate: both views now show a department's
        evidence as soon as that department's own `status` is `"completed"`,
        same moment its green badge appears. Signer identity is still never
        shown to File Management -- only the evidence photo. The
        already-existing per-department/per-item "Reopen" undo (resets a
        signature back to `"pending"`, clears the evidence, requires File
        Management's password) is what actually lets File Management act on
        an unclear signature they spot this way -- no new code needed there,
        it just wasn't very usable before since evidence wasn't visible until
        the end anyway.
      - **Reviewer dashboard heading now shows the reviewer's actual
        department name** (e.g. "الأمن" / "Security") instead of a generic
        "My department's dashboard" label. `POST /auth/login` now embeds
        `departmentName_ar`/`departmentName_en` in the JWT payload (looked up
        from `Department` once at login, same pattern as the existing
        `hasOversightDashboard` lookup) so the frontend doesn't need a
        request loaded first to know its own department's display name.
        Removed the now-dead `reviewer.title` i18n key.
      - Verified live end-to-end against the shared Atlas cluster (not
        reseeded -- ran targeted API calls instead to avoid wiping real
        data): created a real request, signed one department, confirmed File
        Management's `GET /requests/:id` showed that department's evidence
        with `fileManagementApproved` still `false` and no signer name
        leaked, streamed the evidence file directly, reopened it back to
        `"pending"` with evidence cleared, and confirmed both a plain
        reviewer's and an oversight reviewer's login payload carry the
        correct `departmentName_ar/en`. Frontend `npm run build` clean.

- [x] **Fixed a real bug: File Management's evidence preview and Reopen
      button were silently never rendering (2026-08-04).** Caught by
      actually driving the app with a headless browser (Playwright,
      temporary devDependency again) after being told the Reopen button
      wasn't showing up -- `summarizeForFileManagement()` in
      `request.routes.js` built each department's summary object without a
      `signatureMode` field, even though `RequestOversightGrid.jsx` branches
      on `d.signatureMode === "single"` to decide whether to show the
      department-level evidence preview AND the Reopen control.
      `undefined === "single"` is always false, so both silently never
      rendered for File Management -- oversight (wages/finance) was
      unaffected since their view (`withOwnDepartmentAnnotated`) already
      passes through the full department object, `signatureMode` included.
      One-line fix: added `signatureMode: d.signatureMode` to the mapped
      object. Verified live: screenshotted the rendered HTML before (badge
      only, no preview, no button) and after (thumbnail + "Reopen" both
      present) the fix.
- [x] **PDF-uploaded evidence now actually composites, instead of leaving the
      signature cell blank (2026-08-04).** Most real evidence uploads are a
      signed PDF, not a phone photo -- and `drawEvidenceImage()` in
      `clearancePdf.js` only ever handled `image/jpeg`/`image/png`; anything
      else (including `application/pdf`) just returned without drawing
      anything, silently leaving that row's signature cell empty. First pass
      fixed this by embedding the PDF's page directly as a vector object
      (`pdfDoc.embedPdf()` + `page.drawPage()`) -- no new dependency, worked,
      but meant PDF evidence skipped the white-background-stripping treatment
      photos get, so it was a second, inconsistent compositing path. Revised
      same day: the PDF's first page is now rasterized to RGBA pixels first
      (`pdfjs-dist` + `@napi-rs/canvas`, both new deps -- picked over
      shelling out to poppler/`pdftoppm` to avoid a system-binary deployment
      requirement, and over `mupdf` due to its AGPL license, which doesn't
      fit a business app cleanly) so it can go through the exact same
      `stripNearWhiteBackground()` -> `embedPng()` pipeline as a photo,
      instead of two different code paths for the same job. `decodeToRgba`
      became `decodeEvidenceToRgba()` (async now, dispatches on mimetype:
      png/jpeg decode directly, pdf rasterizes first) and
      `drawScaledIntoSignatureCell()` dropped its `drawFn` parameter since
      both branches now always call `page.drawImage()`. Passes
      `standardFontDataUrl` (pdfjs-dist's bundled standard font metrics) to
      `getDocument()` -- without it, a PDF referencing a standard font like
      Helvetica by name (rather than embedding it, e.g. text-based
      signature exports) rendered with visibly wrong glyph spacing. webp
      (accepted on upload, per multer's fileFilter) still isn't composited --
      decode only handles png/jpeg/pdf -- left as a known gap, flagged in a
      comment, since it wasn't the reported problem. Verified: rasterized a
      synthetic PDF signature standalone and confirmed correct glyph
      spacing/positioning, generated a full composited test PDF with it
      blending in identically to photo evidence, then re-verified through
      the actual upload route end to end (signed a real department via the
      running app with a PDF file, downloaded the composited PDF, confirmed
      the same, ~225ms including rasterization -- fine for an on-demand
      generate-and-download action).
- [x] **Reviewers can now undo their own just-signed department/item, not
      just File Management (2026-08-04).** E.g. uploaded the wrong file by
      mistake -- previously only File Management could reopen a signature
      (`POST .../reopen`, `.../items/:itemKey/reopen`), which meant looping
      them in even for an immediate self-caught mistake. Both routes now
      accept either caller: File Management (own filed request, unchanged)
      OR the signing department's own reviewers -- any of a single-mode
      department's 2+ accounts (matching the same "any one of them" rule
      signing itself uses, not just whoever originally signed), or for an
      itemized (IT) item, only the one reviewer it's permanently assigned to
      (matching the sign route's own `assignedItemKey` check). Response
      shape now depends on which kind of caller it was
      (`summarizeForFileManagement()` vs `redactToOwnDepartment()`), where
      before it was always the former. Frontend: extracted the
      password-reauth-collapsed-button pattern (previously duplicated
      inline as `ReopenControl` in `RequestOversightGrid.jsx`) into a shared
      `frontend/src/components/ReauthConfirmButton.jsx`, since the exact
      same interactive pattern was now needed a third time; `RequestOversightGrid.jsx`
      was refactored to use it (no behavior change), and `SignaturePanel.jsx`
      gained a new "Undo" control next to the "signed" banner (single-mode)
      and next to a completed item's confirmation (itemized, only shown on
      the viewing reviewer's own item) -- both call the same backend routes
      `ReviewerDashboard.jsx`'s `handleUndo` already posts to, just
      authenticated as the reviewer instead of File Management. Verified
      live end-to-end (Playwright): signed in as a security reviewer, saw
      the new "تراجع" (Undo) button next to the signed banner, clicked
      through the re-auth confirm, watched the panel revert to the plain
      sign form, and confirmed `backend/scripts/smoke-test.js` now also
      covers both the department- and item-level self-undo paths plus their
      403 boundaries (wrong department / wrong IT reviewer) -- all green.
- [x] **PDF evidence no longer scales down to an illegible sliver when it's a
      whole scanned/exported page (2026-08-04).** Follow-up to the PDF
      rasterization work above, found by testing with real (not synthetic)
      sample signatures: a full A4 PDF page with the actual ink occupying
      only a small portion of it was scaling down along with all of that
      page's empty margin to fit the tiny signature cell, leaving a
      barely-visible smudge even though the source signature itself was
      perfectly legible. New `cropToContent()` in `clearancePdf.js` trims
      the decoded RGBA (photo or rasterized PDF page, same code path either
      way) down to the bounding box of non-near-white content before the
      white-strip step, so only the signature itself gets sized to fill the
      cell regardless of how much blank page surrounds it in the original
      upload -- verified by re-running the same real-file test that
      surfaced the problem and confirming every row now renders at a
      consistent, legible size.
- [x] **Seeded demo evidence now uses a realistic mix of formats, not just 3
      uniform PNGs (2026-08-04).** `backend/src/seed/seed.js`'s
      `planDummySignature()` hardcoded `mimeType: "image/png"` for every
      dummy signature regardless of the source file's real format --
      harmless while the only samples were PNGs, but would have silently
      mislabeled anything else. Replaced the old 3-PNG set (originally
      copied from `frontend/src/assets/`) with 6 real sample signatures
      (jpg, png, and PDF -- including one 2-page and one landscape-oriented
      PDF) added there, re-copied into `backend/assets/dummy-signatures/`,
      and fixed `planDummySignature()` to derive the mimetype from each
      file's actual extension. Seeded demo requests now exercise every
      branch of the evidence-compositing pipeline (image decode, PDF
      rasterize) instead of just one. Not yet re-seeded against the shared
      Atlas cluster -- verified with a standalone script that calls
      `generateClearancePdf()` directly against copies of the new files
      instead, so the live dev database (which currently has real in-progress
      test requests on it) isn't touched without asking first.
- [x] **Removed the "Deleted from AD" stat tile from every dashboard
      (2026-08-04).** `DepartmentDashboard.jsx` had a KPI tile counting
      archived-from-AD requests on IT's and oversight's dashboards. Removed
      the tile and the now-unused `archivedCount` computation from both
      `computeOwnStats()` and `computeCompanyStats()`. The per-request
      "Deleted from AD" badge elsewhere (File Management's list row, the
      oversight/File-Management detail grid's banner, IT's own recent-activity
      rows) is unchanged -- that's a status indicator on a specific request,
      not an aggregate statistic, and wasn't what was asked to go.
- [x] **Reviewers can now preview their own department's signed evidence,
      not just File Management/oversight (2026-08-04).** The backend already
      allowed this -- `GET /requests/:id/evidence/:deptKey` has always let
      any reviewer view evidence for their own `departmentKey`, and
      `redactToOwnDepartment()` never stripped `evidence` off the one
      department entry it keeps -- but `SignaturePanel.jsx` never rendered
      it, only the signer name/date once signed. Extracted `EvidencePreview`
      out of `RequestOversightGrid.jsx` into its own
      `frontend/src/components/EvidencePreview.jsx` (same reasoning as the
      earlier `ReauthConfirmButton` extraction -- a second real use beats
      threading more props through the oversight-grid-specific component)
      and added it to both of `SignaturePanel.jsx`'s "already signed" states:
      the single-mode success banner, and each itemized IT item's
      confirmation block. For itemized items the preview shows regardless of
      whether it's the viewing reviewer's own assigned item (matching the
      existing pattern where any IT reviewer already sees every item's
      signer/status, not just their own) -- only the Undo control stays
      restricted to the assigned reviewer. Needed threading a `requestId`
      prop into `SignaturePanel` (sourced from `ReviewerDashboard.jsx`'s
      `selected._id`) since the evidence route is scoped per-request.
      Verified live for both a single-mode department (security) and an
      itemized IT item (phone) -- each reviewer's own panel now shows their
      thumbnail right next to the signed banner/confirmation.
- [x] **Added a "requested on" date-range filter to every request list
      (2026-08-09), then replaced it with an employee-number search
      (2026-08-10).** `GET /requests` previously ran an unbounded
      `ClearanceRequest.find()` for all three visibility branches (oversight,
      File Management, per-department reviewer) -- fine for demo data, but
      request history only grows over time and there was no way to narrow it
      down. The date-range filter solved that but wasn't how people actually
      look a request up -- they know the employee's number, not when it was
      filed -- so it's now an optional `?employeeNumber=` query param, a
      partial case-insensitive regex match on `employeeNumber`
      (`buildEmployeeNumberFilter()` in `request.routes.js`, regex
      metacharacters escaped since it's user input; applied before the
      existing role-based redaction/summarization so it works identically for
      all three branches). New shared
      `frontend/src/components/EmployeeNumberFilter.jsx` (one text input + a
      clear button, replacing the old two-date-input `DateRangeFilter.jsx`)
      wired into both `ReviewerDashboard.jsx` (own dashboard and oversight)
      and `FileManagementDashboard.jsx`'s request-list tab; each dashboard
      re-fetches whenever the search value changes. Still deliberately no
      pagination -- searching by employee number solves "find a specific old
      request without scrolling forever" the same way the date range did.
- [x] **Batch of HR-driven changes (2026-08-11):**
  - Renamed File Management's display label to "إدارة الوثائق و السجلات" /
    "Document and Records Management" everywhere it's user-facing (locales,
    `demoAccounts.js`, `demo-users.data.js`) -- the internal `role:
    "file_management"` key is unchanged, this is display-only.
  - Reworded the "moving to another company" leaving reason
    (`reasonNewJob`) and expanded `LEAVING_REASONS` from 4 to 13 options to
    match HR's real categories (death, dismissal, secondment/delegation/
    assignment endings, sister-company transfer, driver/fixed-term/
    comprehensive-bonus contract endings, on top of the existing
    resignation/retirement/early-retirement/new-job) -- see
    `ClearanceRequest.js` and `frontend/src/utils/leavingReason.js`. The
    create-request form's reason picker switched from a radio group to a
    `<select>` now that there are 13 options instead of 4.
  - Renamed "النيابة / المساعدة"'s employee-search to also match by name,
    not just employee number -- `buildEmployeeSearchFilter()` (was
    `buildEmployeeNumberFilter()`) now does an `$or` regex match on
    `employeeNumber` OR `employeeFullName` behind a single `?q=` param;
    `EmployeeNumberFilter.jsx` renamed to `EmployeeSearchFilter.jsx`.
  - Registration now requires a `landlineNumber` (company internal/extension
    line) for every role, enforced in `auth.routes.js` (not the schema, so
    seed data is unaffected) and carried in the JWT. Demo accounts got
    sequential extensions (`1000` for File Management, `1001`-`1012` for
    single-mode reviewers, `1101`-`1105` for IT items) in
    `demo-users.data.js`.
  - File Management can now see full signer identity + contact info (name,
    sign date, email, landline) per department/item, same as Wages/Finance
    oversight already could -- a deliberate reversal of the previous "File
    Management never sees signer identity" rule, confirmed with Nader. New
    `signedByLandlineNumber` snapshotted at sign time (same pattern as
    `signedByFullName`), cleared on reopen.
    `summarizeForFileManagement()` and `RequestOversightGrid.jsx` updated
    together (the component's `detail="full"`/`"summary"` prop is gone --
    both callers now render the same signer-info block).
- [x] **Second batch (2026-08-11): Active Directory-specific wording for IT,
  permanent delete, IT's own dashboard no longer hides the pending
  revoke-access action, and the paper form's "البيان" column:**
  - IT's own revoke-access button/hint/busy-label/banner
    (`reviewer.revokeAccessButton` etc.) reworded around "Active Directory"
    specifically ("حذف من الدليل النشط" / "Delete from Active Directory"),
    plus a new blue `.status-pill.awaiting-ad` badge on IT's own request
    cards for `readyForAccessRevocation`. Deliberately scoped to strings that
    were already exclusively IT-facing -- File Management's approve step,
    oversight's badges, and the shared `RequestOversightGrid` banner keep
    the original generic "access/permissions" wording (confirmed with
    Nader).
  - Fixed a real bug this surfaced: IT's own `needsAction` flag didn't
    account for the revoke-access step at all -- once IT's own item/
    department was signed, a fully-signed-and-FM-approved request quietly
    fell into "already signed by your department" instead of "waiting on
    your department", even though IT still had the revoke-access action
    outstanding. `redactToOwnDepartment()` now OR's in a second condition
    (`itAwaitingRevocation`) so it correctly stays in the "needs action"
    bucket (with the new blue badge) until IT actually revokes access.
  - File Management can now permanently delete a request once it's fully
    completed (`POST /:id/delete`, requires `status === "completed"`,
    password re-auth) -- e.g. the employee came back to the company after
    already being cleared. Real hard delete: the MongoDB document and its
    `backend/uploads/<requestId>/` evidence directory are both removed, no
    soft-delete/undo anywhere. (First version allowed deleting at any stage
    -- caught as a bug the same day: it showed a delete button on requests
    still mid-flight, like "all 13 signed, awaiting IT", which was never the
    intent. Scoped down to completed-only, both the route and the button.)
  - The paper form's third column per row, "البيان" (previously deliberately
    left blank), now gets a fixed "خالي الطرف" stamp on every signed row.
    Needed an actual Arabic-capable font (`StandardFonts.Helvetica`, used for
    the "الاسم" column, has no Arabic glyphs, and pdf-lib's standard-font
    path doesn't shape Arabic contextual letterforms anyway) --
    `backend/assets/cairo-arabic.ttf`, decompressed once from the frontend's
    own `cairo-var-arabic.woff2` via the `wawoff2` package, embedded through
    `@pdf-lib/fontkit` (which does shape Arabic correctly via a custom
    embedded font). Scoped to just this one fixed string -- the "الاسم"
    column's Helvetica-based drawing is untouched.

## Team update

**Team is now 3 people: Nader (lead), Ziad, Jana.** Habiba and Khaled's
former tasks were redistributed, not dropped — see `TASKS.md` for the full,
detailed breakdown with Core vs. Stretch priority tags. Short version:
- Nader: admin department-picker bug is fixed — remaining: deploy backend +
  frontend, review PRs, own the demo script.
- Ziad: backend input validation, smoke-testing the deployed backend, and
  (stretch) the history endpoint + admin department-edit endpoints.
- Jana: confirmation dialog on IT's final step, loading/error states, full
  EN/AR + RTL pass, and (stretch) the request-submission form fields.

## Known bugs

None currently known — see "Done" above for the admin department-picker bug
that was fixed.

## Blocked / needs real-world input (not solvable by writing more code)

- [x] ~~Real checklist requirements for 12 of 13 departments.~~ Resolved by
      the 2026-08-03 redesign, not by gathering requirements: 12 of 13
      departments no longer have a checklist at all -- any one of a
      department's 2+ reviewers signing (password re-auth + evidence photo)
      IS the requirement now, matching the one-signature-per-row paper form.
      Only IT still has itemized requirements (5 items, real and confirmed).
- [ ] **Whether departments need a "manager approves after staff" step.**
      Still open. Right now any one of a department's 2+ reviewer accounts
      signing completes it -- there's no concept of a second person
      double-checking. If EGAS wants that, it's a new schema shape (the
      current itemized mode assigns one item to one fixed reviewer, which
      isn't the same as "two people must both sign the same thing") and
      hasn't been designed.
- [ ] **Real Active Directory / LDAP access.** Currently 100% mocked --
      both staff logins (`User`) and the employee directory (`Employee`).
      Nobody on the team has real EGAS LDAP credentials yet (per the July 31
      kickoff conversation). See `CLAUDE.md` "mock Active Directory" for
      exactly what changes when this becomes available.
- [x] ~~"Temporary database" design for post-revocation employees.~~ Resolved
      (2026-08-10, Nader): this system is a coordination bridge between File
      Management and the other departments, not a system of record for AD
      itself -- it doesn't need to actually delete/archive anything. Flipping
      `accessRevoked: true` (and `status` becoming `"completed"`) once IT
      confirms they've done the real revocation elsewhere IS the final
      design, not a placeholder. No separate archival mechanism needed.
- [x] ~~Hosting/deployment target.~~ Resolved (2026-08-10, Nader): a Windows
      Server the company controls, with a local MongoDB instance (not the
      shared Atlas dev cluster) -- see `.env`'s `MONGO_URI` for what needs to
      change at deploy time.
- [x] ~~PDF row coordinates are hand-calibrated against one scanned copy of
      the paper form.~~ Resolved 2026-08-04: EGAS provided a cleaner source
      (see "New paper-form template..." above) and `clearancePdf.js`'s
      `ROWS`/`COLUMNS` were re-tuned against it. Still hand-calibrated
      against this one specific template, though -- if it's ever replaced
      again, re-derive per that file's header comment.

## Open questions for Nader to raise with whoever assigned this project

- Who ends up owning the "manager vs. staff sign-off" question — is that
  actually part of scope, or out of scope for v1?
- Is 2 reviewer accounts per department (so either can sign) actually enough
  coverage in practice, or do some departments need more?

~~Is there a real AD/LDAP test environment...~~ and ~~should a PDF upload
get embedded in the composited form...~~ removed 2026-08-10 — both resolved:
no AD/LDAP integration is ever planned (see "Blocked" above), and PDF
evidence has been rasterized and composited (not a text placeholder) since
2026-08-04, see "PDF-uploaded evidence now actually composites" above.
