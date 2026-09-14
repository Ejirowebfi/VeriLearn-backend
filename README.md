# VeriLearn Backend

A modern, secure **NestJS-based REST API** powering a blockchain education platform built on the **Stellar network**. VeriLearn enables learners to enroll in courses, stream video lessons, and earn tamper-proof on-chain credentials issued as Stellar transactions — all backed by a production-grade backend with MFA, full-text search, real-time monitoring, and email notifications.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)
- [Module Breakdown](#module-breakdown)
- [API Reference](#api-reference)
- [Authentication Flow](#authentication-flow)
- [Credential Flow](#credential-flow)
- [Video Streaming Flow](#video-streaming-flow)
- [Available Scripts](#available-scripts)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

VeriLearn Backend is a production-ready NestJS application that serves as the engine behind a blockchain-powered e-learning platform. It connects three core domains:

1. **Education** — course creation, lesson management, and student enrollment
2. **Blockchain** — on-chain credential issuance via the Stellar network using Soroban smart contracts
3. **Security** — JWT authentication, TOTP-based multi-factor authentication, role-based access control, and comprehensive audit logging

Every time a student completes a course, a credential is written to the Stellar blockchain. This creates a permanent, publicly verifiable record of achievement that cannot be altered or revoked by any single party.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VeriLearn Backend                     │
│                   (NestJS / TypeScript)                  │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│   Auth   │  Users   │ Courses  │Blockchain│  Monitoring  │
│  Module  │  Module  │  Module  │  Module  │   Module     │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│              Common (Guards, Filters, Pipes)             │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│PostgreSQL│  Redis   │Elastic-  │  Stellar │   SMTP       │
│(TypeORM) │ (Cache)  │ search   │ Horizon  │  (Email)     │
└──────────┴──────────┴──────────┴──────────┴─────────────┘
```

The application follows a **modular monolith** pattern — each feature domain is a self-contained NestJS module with its own entities, services, controllers, and DTOs. Modules communicate through NestJS dependency injection rather than direct coupling.

---

## Key Features

| Feature | Description |
|---|---|
| 🔐 **Multi-factor Authentication** | TOTP-based 2FA (Google Authenticator compatible) with QR code generation via `otplib` + `qrcode` |
| 🔗 **Blockchain Credentials** | Stellar Soroban smart contract integration — issues tamper-proof on-chain learning credentials |
| 📊 **Connection Pooling** | Dynamic PostgreSQL pool sizing (configurable min/max) with a circuit breaker that opens after 5 consecutive failures |
| 🎥 **Video Streaming** | HLS manifest + segment streaming, DASH manifest streaming, and MP4 byte-range streaming — all protected by signed tokens |
| 📧 **Email Notifications** | SMTP via Nodemailer with four HTML templates: welcome, email verification, password reset, and course completion |
| 🔍 **Full-text Search** | Elasticsearch integration with fuzzy multi-field matching across course title, description, category, and tags |
| 📈 **Prometheus Metrics** | HTTP request counters, duration histograms, active connection gauges, and DB query duration histograms |
| 🛡️ **Security Auditing** | Every significant action is written to an `audit_logs` table with user, IP, resource, and outcome |
| 🔑 **Role-based Access** | Three roles — `student`, `instructor`, `admin` — enforced via NestJS guards on every protected route |
| ✅ **Input Validation** | Global `ValidationPipe` with `class-validator` DTOs; all inputs are whitelisted and transformed |

---

## How It Works

### User Registration & Login

1. A user registers via `POST /api/v1/auth/register` with email, name, and password.
2. The password is hashed with **bcrypt** (12 rounds) before storage.
3. On login (`POST /api/v1/auth/login`), credentials are validated by the **Passport local strategy**.
4. If MFA is disabled, the server returns a signed **JWT access token** (7-day default) and a **refresh token** (30-day default).
5. If MFA is enabled, the server returns `{ requiresMfa: true, userId }`. The client must then call `POST /api/v1/auth/mfa/verify` with the TOTP token to receive tokens.
6. All subsequent requests include the access token as `Authorization: Bearer <token>`, validated by the **Passport JWT strategy**.

### Multi-Factor Authentication (MFA)

1. A logged-in user calls `POST /api/v1/users/me/mfa/generate`.
2. The server generates a TOTP secret via `otplib`, stores it on the user record, and returns a **base64 QR code** the user scans with an authenticator app.
3. The user confirms setup by calling `POST /api/v1/users/me/mfa/enable` with a valid 6-digit token.
4. From that point, every login requires a second factor.

### Course Lifecycle

1. An **instructor** creates a course (`POST /api/v1/courses`) — it starts in `draft` status.
2. The instructor adds lessons (`POST /api/v1/courses/:id/lessons`) with optional video URLs.
3. The instructor publishes the course by updating its status to `published`.
4. **Students** browse published courses (`GET /api/v1/courses`) and enroll (`POST /api/v1/courses/:id/enroll`).
5. When a student finishes, they call `POST /api/v1/courses/:id/complete`, which marks the enrollment as completed.
6. The student (or system) then calls the blockchain module to issue a credential.

### Blockchain Credential Issuance

1. After course completion, `POST /api/v1/blockchain/credentials/issue` is called with the student's Stellar public key and course ID.
2. The **BlockchainService** first checks that the caller has a completed `Enrollment` for that course — a student who never enrolled, or hasn't finished the course, gets a `403 Forbidden` instead of a credential.
3. It loads the platform's Stellar account via the Horizon API.
4. It builds a **Stellar transaction** with a `manageData` operation that writes credential metadata (userId, courseId, timestamp) onto the ledger.
5. The transaction is signed with the platform's secret key and submitted to the Stellar network.
6. The resulting **transaction hash** is stored in the `credentials` table and returned to the client.
7. Anyone can verify the credential by querying `GET /api/v1/blockchain/credentials/verify/:txHash` or looking it up on the Stellar explorer.

### Video Streaming

1. A client requests a stream token: `POST /api/v1/video/token/:lessonId` (requires JWT auth).
2. The server generates an **HMAC-SHA256 signed token** containing lessonId, userId, and expiry (1 hour).
3. The client uses this token as a query parameter to stream:
   - **HLS**: `GET /api/v1/video/:lessonId/hls?token=...` → serves `index.m3u8`
   - **HLS segments**: `GET /api/v1/video/:lessonId/hls/:segment?token=...` → serves individual `.ts` segments
   - **DASH**: `GET /api/v1/video/:lessonId/dash?token=...` → serves `manifest.mpd`
   - **MP4**: `GET /api/v1/video/:lessonId/mp4?token=...` → supports HTTP byte-range for seeking
4. On every endpoint, the server verifies both the token's signature/expiry **and** that the token's embedded `lessonId` matches the `:lessonId` in the URL — a token minted for one lesson cannot be replayed against another lesson's files.
5. `lessonId` and `segment` path values are validated against a strict allow-list (no `..`, `/`, or `\`) and the resolved file path is re-checked against the storage root before any file read, preventing directory-traversal reads outside `VIDEO_STORAGE_PATH`.

### Search

1. When courses are created or updated, they can be indexed in Elasticsearch.
2. `GET /api/v1/search/courses?q=stellar` performs a **fuzzy multi-match** query across `title` (boosted 3×), `description`, `category`, and `tags`.
3. If Elasticsearch is unavailable, the service degrades gracefully and returns empty results without crashing.

### Monitoring & Audit

- **Prometheus metrics** are exposed at `GET /api/v1/monitoring/metrics` in the standard text format, ready for scraping by a Prometheus server or Grafana agent.
- Every HTTP request is timed by the `LoggingInterceptor` and counted by the metrics service.
- Sensitive actions (login, credential issuance, admin operations) write a row to `audit_logs` via `MonitoringService.audit()`.
- Admins can query audit logs at `GET /api/v1/monitoring/audit`; users can see their own at `GET /api/v1/monitoring/audit/me`.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18.x or 20.x | LTS versions recommended |
| npm | 9.x+ | Comes with Node.js |
| PostgreSQL | 15+ | Primary database |
| Git | Latest | For version control |

### Verify Installation

```bash
node --version    # v18.x.x or v20.x.x
npm --version     # 9.x.x or higher
psql --version    # PostgreSQL 15+
```

---

## Installation

```bash
# 1. Clone
git clone https://github.com/your-org/verilearn-backend.git
cd verilearn-backend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your values
```

---

## Environment Configuration

All configuration is driven by environment variables. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|---|---|---|
| `NODE_ENV` | `development` or `production` | ✅ |
| `PORT` | HTTP port (default `3000`) | |
| `DB_HOST` | PostgreSQL host | ✅ |
| `DB_PASSWORD` | PostgreSQL password | ✅ |
| `DB_NAME` | Database name (default `verilearn`) | ✅ |
| `JWT_SECRET` | JWT signing secret — use a long random string | ✅ (app refuses to boot without it when `NODE_ENV=production`) |
| `JWT_REFRESH_SECRET` | Refresh token secret | ✅ (same production-only enforcement as `JWT_SECRET`) |
| `CORS_ORIGIN` | Allowed origin(s) for browser requests. Comma-separate multiple origins (e.g. `https://app.example.com,https://admin.example.com`). Unset = no cross-origin requests are allowed | Recommended |
| `STELLAR_SECRET_KEY` | Stellar account secret key for signing transactions | ✅ |
| `STELLAR_NETWORK` | `testnet` or `mainnet` | ✅ |
| `EMAIL_USER` | SMTP username | For email features |
| `EMAIL_PASSWORD` | SMTP password / app password | For email features |
| `ELASTICSEARCH_URL` | Elasticsearch URL (default `http://localhost:9200`) | For search |
| `REDIS_HOST` | Redis host | For caching |
| `VIDEO_STORAGE_PATH` | Path to video files directory | For streaming |
| `VIDEO_TOKEN_SECRET` | Secret for signing stream tokens | ✅ (app refuses to boot without it when `NODE_ENV=production`) |

> **Security note:** Never commit `.env` to version control. All secrets should be rotated in production. In development, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `VIDEO_TOKEN_SECRET` fall back to insecure placeholder values with a warning if unset — in production (`NODE_ENV=production`) the app throws at startup instead of running with a guessable secret.

---

## Database Setup

### Option A — Docker (recommended)

```bash
docker-compose up postgres redis elasticsearch -d
```

### Option B — Manual PostgreSQL

```bash
createdb verilearn
```

### Run Migrations

```bash
npm run migration:run
```

This creates all tables: `users`, `courses`, `lessons`, `enrollments`, `credentials`, `audit_logs`.

### Seed Initial Data

```bash
npm run seed
```

Creates:
- **Admin**: `admin@verilearn.io` / `Admin@123456`
- **Instructor**: `instructor@verilearn.io` / `Instructor@123456`
- **Sample course**: "Introduction to Stellar Blockchain" (published)

---

## Running the Application

```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod

# Full Docker stack
docker-compose up --build
```

API available at: `http://localhost:3000`
Swagger UI at: `http://localhost:3000/api/docs`

---

## Running Tests

```bash
npm run test          # Unit tests
npm run test:watch    # Watch mode
npm run test:cov      # Coverage report
npm run test:e2e      # End-to-end tests
```

Unit tests (`npm run test`) are fully mocked — no external services required. `npm run test:e2e` boots the real `AppModule` against live Postgres, Redis, and Elasticsearch, so those services must be running first (`docker-compose up postgres redis elasticsearch -d`), and the database must be migrated and seeded (`npm run migration:run && npm run seed`) since the course e2e spec logs in as the seeded instructor account.

---

## Project Structure

```
src/
├── main.ts                          # Bootstrap: Swagger, pipes, guards, CORS, Helmet
├── app.module.ts                    # Root module — imports all feature modules
│
├── config/                          # Typed config factories (registerAs)
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── jwt.config.ts
│   ├── stellar.config.ts
│   ├── email.config.ts
│   └── redis.config.ts
│
├── database/                        # TypeORM setup
│   ├── database.module.ts           # Async TypeORM config with pool settings
│   ├── connection-pool.service.ts   # Circuit breaker wrapper
│   ├── data-source.ts               # TypeORM CLI data source
│   ├── migrations/
│   │   └── 1700000000000-InitialSchema.ts
│   └── seeds/
│       └── run-seed.ts
│
├── auth/                            # Authentication
│   ├── auth.module.ts
│   ├── auth.service.ts              # validateUser, register, login, MFA verify, refresh
│   ├── auth.controller.ts           # /auth/* endpoints
│   ├── dto/auth.dto.ts
│   ├── strategies/
│   │   ├── jwt.strategy.ts          # Validates Bearer tokens
│   │   └── local.strategy.ts        # Validates email/password
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── local-auth.guard.ts
│   │   └── roles.guard.ts
│   └── decorators/
│       └── roles.decorator.ts
│
├── users/                           # User management
│   ├── users.module.ts
│   ├── users.service.ts             # CRUD, password change, MFA setup
│   ├── users.controller.ts          # /users/* endpoints
│   ├── dto/user.dto.ts
│   └── entities/
│       └── user.entity.ts           # roles: student | instructor | admin
│
├── courses/                         # Course delivery
│   ├── courses.module.ts
│   ├── courses.service.ts           # CRUD, enroll, complete
│   ├── courses.controller.ts        # /courses/* endpoints
│   ├── dto/course.dto.ts
│   └── entities/
│       └── course.entity.ts         # Course, Lesson, Enrollment
│
├── blockchain/                      # Stellar integration
│   ├── blockchain.module.ts
│   ├── blockchain.service.ts        # issueCredential, verifyCredential, getBalance
│   ├── blockchain.controller.ts     # /blockchain/* endpoints
│   └── entities/
│       └── credential.entity.ts
│
├── email/                           # Email notifications
│   ├── email.module.ts
│   └── email.service.ts             # welcome, verify, reset, completion templates
│
├── search/                          # Elasticsearch
│   ├── search.module.ts
│   ├── search.service.ts            # index, delete, fuzzy search
│   └── search.controller.ts         # GET /search/courses?q=
│
├── video-streaming/                 # Video delivery
│   ├── video-streaming.module.ts
│   ├── video-streaming.service.ts   # HLS, DASH, MP4 range, DRM tokens
│   └── video-streaming.controller.ts
│
├── monitoring/                      # Observability
│   ├── monitoring.module.ts
│   ├── monitoring.service.ts        # Prometheus metrics + audit logging
│   ├── monitoring.controller.ts     # /monitoring/metrics, /monitoring/audit
│   └── entities/
│       └── audit-log.entity.ts
│
├── health/                          # Liveness/readiness check
│   ├── health.module.ts
│   └── health.controller.ts         # GET /health — checks DB, Redis, Elasticsearch
│
└── common/                          # Shared cross-cutting concerns
    ├── filters/
    │   └── http-exception.filter.ts  # Standardised error responses
    ├── interceptors/
    │   ├── logging.interceptor.ts    # Request timing logs
    │   └── transform.interceptor.ts  # Wraps all responses in { success, data, timestamp }
    ├── pipes/
    │   └── parse-uuid.pipe.ts
    └── decorators/
        ├── current-user.decorator.ts
        └── public.decorator.ts
```

---

## Module Breakdown

### Auth Module
Handles all authentication concerns. Uses **Passport.js** with two strategies:
- `LocalStrategy` — validates email + password on login
- `JwtStrategy` — validates Bearer tokens on every protected request

The `AuthService` generates both an **access token** (short-lived) and a **refresh token** (long-lived, different secret). MFA verification is handled by `otplib`'s TOTP implementation, which is compatible with Google Authenticator, Authy, and any RFC 6238 app.

### Users Module
Manages user profiles and MFA lifecycle. Passwords are hashed with **bcrypt** at cost factor 12. The MFA flow:
1. `generateMfaSecret` — creates a secret, stores it, returns a QR code data URL
2. `enableMfa` — verifies a TOTP token against the stored secret, then sets `isMfaEnabled = true`
3. `disableMfa` — clears the secret and flag

### Courses Module
Three entities share this module:
- **Course** — owned by an instructor, has status (`draft`/`published`/`archived`) and level
- **Lesson** — belongs to a course, has an optional video URL and ordering
- **Enrollment** — join table between user and course, tracks completion and credential tx hash

Role enforcement: only `instructor` or `admin` can create/update/delete courses. Any authenticated user can enroll in a published course.

### Blockchain Module
Integrates with the **Stellar Horizon API** using `@stellar/stellar-sdk`. The credential issuance flow:
1. Verifies the caller has a completed enrollment in the target course (`403` otherwise)
2. Loads the platform's Stellar account
3. Builds a transaction with a `manageData` operation encoding credential metadata
4. Signs and submits the transaction
5. Stores the resulting tx hash in the `credentials` table

If the Stellar submission fails (network error, insufficient balance), the credential is saved as `isVerified: false` for retry. Verification is done by querying the Horizon API for the transaction hash.

### Email Module
Uses **Nodemailer** with a configurable SMTP transport. Four HTML email templates are built inline:
- **Welcome** — sent on registration
- **Email Verification** — contains a tokenised verification link
- **Password Reset** — contains a time-limited reset link
- **Course Completion** — includes the Stellar transaction hash and a link to the explorer

### Search Module
Wraps the **Elasticsearch Node.js client**. On startup, it pings Elasticsearch and creates the `courses` and `users` indices if they don't exist. If Elasticsearch is unreachable, the module logs a warning and all search calls return `{ hits: [], total: 0 }` — the rest of the application is unaffected.

Search uses a `multi_match` query with `fuzziness: AUTO`, boosting the `title` field 3× over description, category, and tags.

### Video Streaming Module
Serves pre-encoded video files from a local storage directory. Stream tokens are **HMAC-SHA256 signed** payloads containing lessonId, userId, and expiry — no database lookup required on each segment request. Every stream endpoint checks the token's lessonId against the requested lesson and validates path segments before touching the filesystem. Supports:
- **HLS** — serves `.m3u8` manifest and `.ts` segments
- **DASH** — serves `.mpd` manifest
- **MP4** — supports `Range` headers for browser seek/scrub

### Monitoring Module
Uses **prom-client** to expose standard Prometheus metrics plus four custom metrics. The `MonitoringService` also provides an `audit()` method used throughout the app to write structured audit log entries. The `/monitoring/metrics` endpoint is intentionally left unauthenticated so Prometheus can scrape it without a token (restrict at the network/firewall level in production).

### Health Module
Exposes `GET /api/v1/health`, which checks Postgres (`SELECT 1`), Redis (`PING`), and Elasticsearch (`ping()`) in parallel and returns `{ status: 'ok' | 'degraded', services: { db, redis, elasticsearch } }`. Each dependency check is wrapped in its own try/catch, so one failing service reports `degraded` rather than throwing a 500. Suitable for use as a container orchestrator liveness/readiness probe.

### Database Module
Configures TypeORM with async factory injection. The `ConnectionPoolService` wraps database operations in a **circuit breaker**: after 5 consecutive failures it opens the circuit for 30 seconds, preventing a cascade of failed DB calls from overwhelming the system.

---

## API Reference

Full interactive documentation is available at `http://localhost:3000/api/docs` (Swagger UI).

### Endpoints Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | — | Register new user |
| `POST` | `/api/v1/auth/login` | — | Login (returns tokens or MFA challenge) |
| `POST` | `/api/v1/auth/mfa/verify` | — | Complete MFA login |
| `POST` | `/api/v1/auth/refresh` | — | Refresh access token |
| `POST` | `/api/v1/auth/forgot-password` | — | Request password reset email |
| `GET` | `/api/v1/users/me` | JWT | Get own profile |
| `PATCH` | `/api/v1/users/me` | JWT | Update own profile |
| `POST` | `/api/v1/users/me/change-password` | JWT | Change password |
| `POST` | `/api/v1/users/me/mfa/generate` | JWT | Generate MFA QR code |
| `POST` | `/api/v1/users/me/mfa/enable` | JWT | Enable MFA |
| `POST` | `/api/v1/users/me/mfa/disable` | JWT | Disable MFA |
| `GET` | `/api/v1/users` | JWT + Admin | List all users |
| `DELETE` | `/api/v1/users/:id` | JWT + Admin | Delete user |
| `GET` | `/api/v1/courses` | — | List published courses |
| `GET` | `/api/v1/courses/:id` | — | Get course details + lessons |
| `POST` | `/api/v1/courses` | JWT + Instructor | Create course |
| `PATCH` | `/api/v1/courses/:id` | JWT + Owner | Update course |
| `DELETE` | `/api/v1/courses/:id` | JWT + Owner | Delete course |
| `POST` | `/api/v1/courses/:id/lessons` | JWT + Owner | Add lesson |
| `POST` | `/api/v1/courses/:id/enroll` | JWT | Enroll in course |
| `POST` | `/api/v1/courses/:id/complete` | JWT | Mark course complete |
| `GET` | `/api/v1/courses/my/enrollments` | JWT | My enrollments |
| `POST` | `/api/v1/blockchain/credentials/issue` | JWT | Issue Stellar credential |
| `GET` | `/api/v1/blockchain/credentials/me` | JWT | My credentials |
| `GET` | `/api/v1/blockchain/credentials/verify/:txHash` | JWT | Verify credential |
| `GET` | `/api/v1/blockchain/account/:publicKey/balance` | JWT | Stellar account balance |
| `POST` | `/api/v1/blockchain/keypair/generate` | JWT | Generate Stellar keypair |
| `GET` | `/api/v1/search/courses?q=` | — | Search courses |
| `POST` | `/api/v1/video/token/:lessonId` | JWT | Get stream token |
| `GET` | `/api/v1/video/:lessonId/hls?token=` | Token | HLS manifest |
| `GET` | `/api/v1/video/:lessonId/hls/:segment?token=` | Token | HLS segment |
| `GET` | `/api/v1/video/:lessonId/dash?token=` | Token | DASH manifest |
| `GET` | `/api/v1/video/:lessonId/mp4?token=` | Token | MP4 stream |
| `POST` | `/api/v1/video/drm/license/:keyId` | JWT | DRM license key |
| `GET` | `/api/v1/monitoring/metrics` | — | Prometheus metrics |
| `GET` | `/api/v1/monitoring/audit` | JWT + Admin | All audit logs |
| `GET` | `/api/v1/monitoring/audit/me` | JWT | My audit logs |
| `GET` | `/api/v1/health` | — | Health check |

---

## Authentication Flow

```
Client                          Server
  │                               │
  ├─ POST /auth/register ────────►│ Hash password, create user
  │◄─ { accessToken, refreshToken, user } ─┤
  │                               │
  ├─ POST /auth/login ───────────►│ Validate credentials
  │  (MFA disabled)               │
  │◄─ { accessToken, refreshToken } ──────┤
  │                               │
  ├─ POST /auth/login ───────────►│ Validate credentials
  │  (MFA enabled)                │
  │◄─ { requiresMfa: true, userId } ──────┤
  │                               │
  ├─ POST /auth/mfa/verify ──────►│ Verify TOTP token
  │◄─ { accessToken, refreshToken } ──────┤
  │                               │
  ├─ GET /users/me ──────────────►│ Validate JWT
  │  Authorization: Bearer <token>│
  │◄─ { success: true, data: user } ──────┤
  │                               │
  ├─ POST /auth/refresh ─────────►│ Verify refresh token
  │◄─ { accessToken, refreshToken } ──────┤
```

---

## Credential Flow

```
Student                         VeriLearn API              Stellar Network
   │                                 │                           │
   ├─ POST /courses/:id/complete ───►│ Mark enrollment complete  │
   │◄─ { enrollment } ──────────────┤                           │
   │                                 │                           │
   ├─ POST /blockchain/credentials   │                           │
   │   /issue ──────────────────────►│ Load platform account     │
   │   { courseId, stellarPublicKey }│ Build manageData tx ─────►│
   │                                 │                           │ Sign & submit
   │                                 │◄─ { hash, ledger } ───────┤
   │                                 │ Save credential record    │
   │◄─ { txHash, isVerified: true } ─┤                           │
   │                                 │                           │
   ├─ GET /blockchain/credentials    │                           │
   │   /verify/:txHash ─────────────►│ Query Horizon API ───────►│
   │◄─ true ─────────────────────────┤◄─ transaction found ──────┤
```

---

## Video Streaming Flow

```
Client                          VeriLearn API              Storage
  │                                  │                        │
  ├─ POST /video/token/:lessonId ───►│ Generate HMAC token    │
  │◄─ { token } ────────────────────┤                        │
  │                                  │                        │
  ├─ GET /video/:id/hls?token= ─────►│ Verify token           │
  │                                  ├─ Read index.m3u8 ─────►│
  │◄─ HLS manifest ─────────────────┤◄──────────────────────┤
  │                                  │                        │
  ├─ GET /video/:id/hls/seg0.ts ────►│ Verify token           │
  │   ?token=                        ├─ Read seg0.ts ─────────►│
  │◄─ TS segment ───────────────────┤◄──────────────────────┤
```

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Start with hot reload (development) |
| `npm run start:prod` | Start compiled production build |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run test` | Run unit tests with Jest |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:cov` | Jest with coverage report |
| `npm run test:e2e` | End-to-end tests |
| `npm run migration:run` | Apply all pending migrations |
| `npm run migration:generate` | Generate migration from entity changes |
| `npm run migration:revert` | Revert the last applied migration |
| `npm run seed` | Seed database with admin, instructor, and sample course |
| `npm run lint` | ESLint with auto-fix |
| `npm run format` | Prettier formatting |

---

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for solutions to common issues including:
- Database connection failures
- JWT / MFA errors
- Stellar transaction failures
- Elasticsearch degraded mode
- Video streaming token errors
- Docker startup issues

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

Please follow the existing code style, add tests for new features, and update this README if you add new modules or endpoints.

---

## License

MIT © VeriLearn
