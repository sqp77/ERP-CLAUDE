# Eayni ERP — نظام إدارة موارد جمعية عيني لإعادة التدوير التعاونية

Web ERP for **جمعية عيني لإعادة التدوير التعاونية**: one module per department on a shared platform (React + Express + MongoDB, serverless deployment).

- Project rules, architecture, stack and build order: [CLAUDE.md](CLAUDE.md)
- Requirements (source of truth, Arabic, verbatim): [docs/SPECS.md](docs/SPECS.md)
- Decisions that settle what the specs leave open: [docs/DECISIONS.md](docs/DECISIONS.md)
- Original PDFs, reference only: [docs/specs/originals/](docs/specs/originals/)

## Run locally (no external services needed)

Requirements: Node.js 20+ (tested on 22 and 26). MongoDB is **not** required: the API starts an in-process
MongoDB (single-node replica set, data persisted under `apps/api/.data/mongo`). The first run downloads
the MongoDB binary (~100 MB).

```bash
npm install
npm run seed      # departments, sample branch/site, holidays, admin user (idempotent)
npm run dev       # API http://localhost:4000 + web http://localhost:5173
```

Sign in at <http://localhost:5173> with `admin@eayni.local` / `Admin12345!`
(override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before seeding). The admin role requires
TOTP: scan the QR code with an authenticator app on first login, then change the temporary password.

### Sample accounts (local seed only)

`npm run seed` also creates 25 sample employees with a real manager chain (CEO → department managers → staff),
contracts (some close to expiry), identity documents close to expiry, custody items, a pending bank-change request, and eight
HR requests in different states (awaiting manager, awaiting HR, returned for completion, approved with an issued certificate,
rejected, and an advance waiting for Finance). All sample accounts
use the password `Sample12345!` (override with `SEED_SAMPLE_PASSWORD`). Useful logins:

| Email | Role |
|---|---|
| abdullah@eayni.local | الإدارة التنفيذية (executive) |
| noura@eayni.local | مدير الموارد البشرية (hr_manager, TOTP required) |
| sara@eayni.local | مسؤول الموارد البشرية (hr_officer, TOTP required) |
| khalid@eayni.local | مدير التشغيل (department_manager for ops) |
| sultan@eayni.local | مدير المبيعات (department_manager for sales) |
| abdulaziz@eayni.local | مدير المالية (finance_manager, TOTP required) |
| omar@eayni.local | موظف ميداني في التشغيل (employee) |

The seed is idempotent and skips employees once they exist; to get a fresh sample set (e.g. after a new slice adds
sample records) stop the dev server, delete `apps/api/.data/mongo` and run `npm run seed` again.

The seed refuses to run against anything that is not a loopback database (`assertLocalDatabase`), so these
passwords can never reach staging or production.

Password-reset emails are not sent locally (email channel off, DECISIONS §9); the reset link is shown
on the forgot-password page in development.

```bash
npm run test        # API tests (Vitest + Supertest + in-memory MongoDB replica set)
npm run lint
npm run typecheck
npm run build -w apps/web
```

Environment variables (all optional locally): `MONGODB_URI` (use a real cluster instead of the embedded
one), `PORT`, `APP_SECRET`, `APP_URL`, `API_URL`, `FILE_STORAGE=local|s3`, `S3_BUCKET`, `AWS_REGION`,
`LOG_LEVEL`. In deployed stages secrets come from SSM (see `serverless.yml`). Never commit `.env` files.

## Repository layout

```
apps/api        Express API (modular monolith). src/core = platform core; src/modules = departments (from phase 1)
apps/web        React + Vite staff app (Arabic, RTL, phone-first)
packages/shared zod schemas, enums, permission model, workflow config, settings registry
docs/           SPECS.md (requirements), DECISIONS.md, original PDFs
serverless.yml  AWS Lambda deployment (written; not run until DECISIONS §1 is cleared)
```
