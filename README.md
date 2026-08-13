# EGAS Employee Clearance System

A bilingual web application for managing EGAS employee clearance requests
(`إخلاء طرف`). File Management files a request for a departing employee, the
13 departments review and sign it, File Management verifies the collected
evidence, and IT revokes the employee's system access as the final clearance
step.

The employee being cleared never logs in. Staff use email/password accounts
with role-based dashboards and server-enforced visibility rules.

## Features

- Arabic-first interface with full RTL support and an English language toggle.
- Responsive light and dark themes.
- Email/password login with admin-managed account provisioning (no
  self-registration).
- Role-protected File Management, reviewer, admin, and super admin dashboards.
- In-browser first-run setup flow that creates the very first (super admin)
  account on a brand-new deployment.
- Config-driven department order, tiers, and signature modes.
- Parallel tier-1 review followed by gated Wages and Finance review.
- Password re-authentication before every signature, reopen, approval, or
  access-revocation action.
- JPG, PNG, WEBP, and PDF signature/stamp evidence uploads.
- Inline evidence previews with permission checks enforced by the backend.
- Itemized IT clearance with five separately owned checklist items.
- File Management evidence review, reopen controls, and final approval.
- Composited clearance PDF generated from the official form template.
- Reviewer and File Management analytics for workload, completion, reasons,
  monthly trends, employee departments, and recent activity.
- Deterministic demo accounts and two fully populated demo requests.
- A login-page demo account picker that fills credentials automatically.

## Roles and visibility

| Role | Responsibilities | Data visibility |
|---|---|---|
| File Management | Creates requests, monitors the shared queue, reviews evidence, reopens unclear signatures, approves fully signed requests, and downloads PDFs | All clearance requests; department status and evidence are visible, but signer identity is redacted |
| Department reviewer | Signs or reopens their own department after re-entering their password | Only their own department slice of each unlocked request |
| IT reviewer | Owns one of IT's five checklist items and can perform the final access-revocation action | IT checklist details only; receives safe readiness flags without seeing other departments |
| Wages or Finance reviewer | Signs their department and provides oversight | Full 13-department status, signer, timestamp, and evidence details for every request |
| Admin | Creates File Management/reviewer accounts, and can reset a password or permanently delete one | No visibility into or action on clearance requests |
| Super Admin | Creates admin accounts, and can reset a password or permanently delete one; there is exactly one super admin account and it cannot create another; cannot create File Management/reviewer accounts directly | No visibility into or action on clearance requests |

There is no self-registration. Every File Management/reviewer account is
created by an admin from the `/admin` dashboard; every admin account is
created by a super admin from `/super-admin`. The very first account of all
is created once through an in-browser first-run setup flow on a brand-new
deployment (zero accounts in the database), which creates a super admin.

## Clearance workflow

1. **Account access**
   - Staff sign in with an email and password. File Management/reviewer
     accounts are created by an admin from `/admin`; admin accounts are
     created by a super admin from `/super-admin` — there is no self-service
     sign-up at any level.
   - A brand-new deployment (zero accounts) shows an in-browser first-run
     setup form instead of a login screen, to create the first (super admin)
     account.
   - Reviewer department choices come from the seeded `Department` records.
     For IT, the admin also picks one unclaimed checklist item for that
     reviewer.
   - Anyone locked out can find an admin's (or super admin's) contact info
     from the login page without needing a token first (password resets are
     admin- or super-admin-assisted, not self-service; IT no longer has a
     special role in this, see below).

2. **File Management creates the request**
   - File Management enters the employee's name, employee number, job title,
     department, leaving reason, and last working day.
   - Leaving reasons are resignation, moving to a new job, or retirement.
   - The employee data and current 13-department configuration are snapshotted
     into the request. There is no separate employee directory.

3. **Tier 1 signs in parallel**
   - Departments 1–11 are tier 1 and can work concurrently.
   - Twelve departments use a single department signature.
   - Signing requires the current reviewer's password plus a photo or PDF of
     the physical signature or stamp.

4. **IT completes five itemized reviews**
   - Mobile and data lines
   - Phone
   - PC, account, and mailbox
   - SAP services
   - SAP account removal

   Each item is permanently assigned to one IT reviewer account. IT becomes
   complete only when all five items are signed.

5. **Tier 2 unlocks**
   - Wages and Entitlements and Financial Affairs unlock together after every
     tier-1 department is complete.
   - Their reviewers also receive the full oversight dashboard.

6. **File Management reviews the signed clearance**
   - All File Management accounts share the same request queue, regardless of
     which File Management account originally filed a request.
   - Once all 13 departments are signed, File Management can preview the
     composited PDF and inspect every evidence file.
   - An unclear department signature or IT item can be reopened. Reopening
     clears that signature/evidence and revokes any prior File Management
     approval.
   - When everything is legible, File Management re-enters its password and
     approves the clearance.

7. **IT revokes system access**
   - Any IT reviewer can perform the final action once all departments are
     signed and File Management has approved.
   - The action requires password re-authentication and sets
     `accessRevoked: true`.
   - Only this final action changes the request from `in_progress` to
     `completed`.

```mermaid
flowchart TD
    A[File Management creates request] --> B[Tier 1: departments 1-11 sign in parallel]
    B --> C[IT completes all 5 assigned checklist items]
    B --> D{All tier-1 departments complete?}
    C --> D
    D -- No --> B
    D -- Yes --> E[Tier 2: Wages and Finance unlock]
    E --> F{All 13 departments signed?}
    F -- No --> E
    F -- Yes --> G[File Management reviews evidence and PDF]
    G -->|Evidence unclear| H[Reopen department or IT item]
    H --> B
    G -->|Approved| I[IT revokes system access]
    I --> J[Request completed]
```

## Department order

| Order | Key | Department | Tier | Signature mode |
|---:|---|---|---:|---|
| 1 | `illicit_gains` | Illicit Gains | 1 | Single |
| 2 | `library` | Library | 1 | Single |
| 3 | `security` | Security | 1 | Single |
| 4 | `legal` | Legal Affairs | 1 | Single |
| 5 | `medical` | Medical and Treatment Affairs | 1 | Single |
| 6 | `healthcare_accounts` | Healthcare Accounts | 1 | Single |
| 7 | `hr_development` | HR Development | 1 | Single |
| 8 | `public_relations` | Public Relations and Social Services | 1 | Single |
| 9 | `warehouses` | Warehouses | 1 | Single |
| 10 | `it` | IT and Communications Systems | 1 | Five itemized signatures |
| 11 | `transport` | Transportation Services | 1 | Single |
| 12 | `wages` | Wages and Entitlements | 2 | Single + oversight |
| 13 | `finance` | Financial Affairs | 2 | Single + oversight |

The source of truth is `backend/src/seed/departments.data.js`. Requests store a
snapshot so later template changes do not alter requests already in progress.

## Quick start

### Requirements

- Node.js 18 or newer
- npm
- PostgreSQL locally (or any reachable Postgres instance)

### Installation

```bash
git clone https://github.com/Abdo-N/Egas-clearance.git
cd Egas-clearance

npm install
npm install --prefix backend
npm install --prefix frontend

cp backend/.env.example backend/.env
```

Configure `backend/.env`:

```dotenv
PORT=4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/egas_clearance
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=8h
```

Seed the reference data, demo accounts, signatures, and demo requests:

```bash
npm run seed:dev --prefix backend
```

For a real deployment with no demo data, use `npm run seed:final --prefix backend`
instead — it upserts only the 13 real departments.

Start the frontend and backend together:

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Health check: http://localhost:4000/api/health

The frontend development server proxies `/api` to the backend.

## Demo accounts and data

Every seeded demo account uses:

```text
DemoPassw0rd!
```

| Account | Email |
|---|---|
| Super Admin | `superadmin@demo.local` |
| Admin | `admin@demo.local` |
| File Management | `file.management@demo.local` |
| A non-IT department reviewer | `<department-key>@demo.local` |
| IT Mobile and Data Lines | `it.mobile_data_lines@demo.local` |
| IT Phone | `it.phone@demo.local` |
| IT PC, Account, and Mailbox | `it.pc_account_mailbox@demo.local` |
| IT SAP Services | `it.sap_service@demo.local` |
| IT SAP Account Removal | `it.sap_account_removal@demo.local` |

Examples of non-IT reviewer emails are `security@demo.local`,
`wages@demo.local`, and `finance@demo.local`. The complete list is in
`backend/src/seed/demo-users.data.js` and is mirrored by
`frontend/src/demoAccounts.js` for the login-page picker.

The seed creates two requests using evidence from `frontend/src/assets`:

| Employee number | State |
|---|---|
| `DEMO-1001` | Fully signed, File Management approved, access revoked, and completed |
| `DEMO-1002` | Fully signed and approved; waiting only for IT to revoke access |

The seed is idempotent. It upserts the 13 departments and 20 demo accounts,
then replaces only the two fixed demo requests and their evidence directories.
Unrelated users and requests are preserved.

## Dashboards

### File Management

- **Create request:** manually enter employee and departure information.
- **Requests I have filed:** review status, evidence, approval readiness, and
  final completion for requests created by the logged-in account.
- **Analytics:** view request totals, status distribution, reasons, monthly
  trends, employee-department distribution, and recent activity.
- Preview or download the composited clearance PDF after all departments sign.

### Reviewers

- Separate lists for work awaiting the reviewer and previously handled work.
- Department-specific completion and turnaround analytics.
- Evidence preview and self-service undo/reopen before final completion.
- IT-specific checklist analytics and final access-revocation control.
- Wages and Finance company-wide oversight charts and full request details.

## Evidence and generated PDFs

Uploads are stored under `backend/uploads/<request-id>/`, which is excluded
from Git. Evidence metadata is stored on the clearance request.

`GET /api/requests/:id/pdf` generates the signed form on demand from
`backend/assets/clearance-form-template.pdf`:

- JPG and PNG evidence is decoded directly.
- The first page of PDF evidence is rasterized.
- Near-white backgrounds are removed and content is cropped before placement.
- The first two parts of the signer's account name are drawn in the matching
  paper-form name cell so long names remain readable; the full name remains
  stored on the request for auditing.
- WEBP uploads remain viewable but are not currently composited into the PDF.

## API overview

All routes are prefixed with `/api`.

| Method and path | Purpose |
|---|---|
| `GET /health` | Health check |
| `POST /auth/login` | Authenticate and issue a JWT |
| `GET /auth/setup-status` | Public: whether the database has zero accounts and needs first-run setup |
| `POST /auth/setup` | Public, one-time only: create the first (super admin) account on a brand-new deployment |
| `GET /auth/accounts` | Admin: list File Management/reviewer accounts. Super admin: list admin accounts |
| `POST /auth/accounts` | Admin: create a File Management or reviewer account. Super admin: create an admin account (only one super admin can ever exist) |
| `POST /auth/reset-password` | Admin/super admin: issue a one-time password, scoped to the accounts they manage (IT has no special access here) |
| `POST /auth/delete-account` | Admin/super admin: permanently delete an account, scoped to the accounts they manage (IT has no special access here) |
| `GET /auth/it-contacts` / `GET /auth/admin-contacts` | Public: IT/admin/super-admin contact info. Admin contacts are who a locked-out user should actually reach for a password reset |
| `GET /departments` | Public department/reference data used by dashboards and the admin/super-admin account-creation forms |
| `POST /requests` | File Management creates a clearance request |
| `GET /requests` | Role-filtered request list |
| `GET /requests/:id` | Role-filtered request detail |
| `POST /requests/:id/departments/:deptKey/sign` | Sign a single-mode department |
| `POST /requests/:id/departments/:deptKey/items/:itemKey/sign` | Sign an IT checklist item |
| `POST .../reopen` | Reopen a signed department or IT item |
| `POST /requests/:id/approve-clearance` | File Management approves all evidence |
| `POST /requests/:id/revoke-access` | IT performs the final access-revocation step |
| `GET /requests/:id/evidence/:deptKey/:itemKey?` | Fetch authorized evidence |
| `GET /requests/:id/pdf` | Generate the composited clearance PDF |

Protected routes require `Authorization: Bearer <jwt>`.

## Development commands

```bash
# Run both development servers
npm run dev

# Run only one side
npm run dev --prefix backend
npm run dev --prefix frontend

# Build the frontend
npm run build --prefix frontend

# Reapply the deterministic demo seed
npm run seed:dev --prefix backend

# Seed only the real departments (no demo data) -- for real deployments
npm run seed:final --prefix backend

# Optional destructive/manual workflow test against a running seeded server
node backend/scripts/smoke-test.js
```

The smoke test creates uniquely named throwaway accounts, a completed request,
and uploaded evidence in the configured development database. Rerun the seed if
you want to restore the two canonical demo requests afterward; unrelated smoke
records are intentionally not deleted automatically.

## Project structure

```text
Egas-clearance/
├── backend/
│   ├── assets/                 Clearance form template and demo signatures
│   ├── scripts/smoke-test.js   Manual end-to-end workflow test
│   ├── src/
│   │   ├── config/             Sequelize/PostgreSQL connection
│   │   ├── middleware/         JWT and role/department guards
│   │   ├── models/             Sequelize models: User, Department, ClearanceRequest
│   │   ├── routes/             Auth, department, and request APIs
│   │   ├── seed/               Department and deterministic demo data
│   │   ├── services/           Signed clearance PDF generation, request assembly
│   │   └── utils/              Async error handling and password policy
│   └── uploads/                Runtime evidence files; ignored by Git
├── frontend/
│   └── src/
│       ├── api/                Authenticated Axios client
│       ├── components/         Dashboards, evidence, signatures, controls
│       ├── context/            Authentication and theme state
│       ├── locales/            Arabic and English translations
│       ├── pages/              Login, first-run setup, and role dashboards
│       └── utils/              Formatting and leaving-reason helpers
├── CLAUDE.md                   Detailed engineering and business rules
└── PROJECT_STATUS.md           Historical implementation tracker
```

## Sanity checks

Before committing changes:

```bash
# Backend JavaScript syntax
find backend/src backend/scripts -name '*.js' -print0 | xargs -0 -n1 node --check

# Frontend compilation and production bundle
npm run build --prefix frontend

# Dependency tree checks
npm ls
npm ls --prefix backend
npm ls --prefix frontend

# Whitespace/conflict-marker check
git diff --check
```

## Known limitations

- Authentication is application-local; there is no real LDAP or Active
  Directory integration yet.
- Password resets are admin- or super-admin-assisted (a one-time password
  handed off directly); IT no longer has a role in this. There is no email
  infrastructure for self-service reset links.
- `revoke-access` records that IT completed the external access-removal task;
  it does not call an identity provider or directory API.
- Uploaded evidence is stored on the backend filesystem rather than durable
  object storage.
- JWTs are stored in browser local storage. A production deployment should
  evaluate secure HTTP-only cookies and CSRF protections.
- PDF row coordinates are calibrated to the included clearance template and
  may need adjustment if that file changes.
- WEBP evidence can be uploaded and viewed but is not yet embedded in the
  generated PDF.
- Demo credentials and the login-page account picker are intended only for
  development and demonstrations.

## Technology

- **Backend:** Node.js, Express, PostgreSQL/Sequelize, JWT, bcryptjs, multer,
  pdf-lib, pdfjs-dist, `@napi-rs/canvas`, pngjs, and jpeg-js.
- **Frontend:** React 18, Vite, React Router, Axios, react-i18next, and
  Recharts.
