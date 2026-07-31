# InkFlow Enterprise NestJS REST API Backend

Production-ready REST API backend built with **NestJS**, **Prisma ORM**, and **MongoDB** powering the InkFlow publishing platform.

---

## 🛠️ Tech Stack & Architecture

- **Framework**: NestJS (TypeScript, Strict mode)
- **Database**: MongoDB via Prisma ORM
- **Authentication**: JWT Access Token (15m), JWT Refresh Token (7d), `httpOnly` cookies
- **Authorization**: Role-Based Access Control (RBAC) via `@Roles()` decorator & `RolesGuard` (`ADMIN`, `WRITER`, `READER`)
- **Documentation**: OpenAPI 3.0 / Swagger UI (`/api/docs`)
- **Security**: Helmet, CORS, Rate Limiting, Input Validation (`class-validator`)
- **Response Format**: Standardized JSON response envelope

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 3. Generate Prisma Client & Seed MongoDB
```bash
npx prisma generate
npx ts-node prisma/seed.ts
```

### 4. Run Development Server
```bash
npm run start:dev
```

API will be running live at `http://localhost:4000/api`  
Interactive Swagger documentation available at `http://localhost:4000/api/docs`.

---

## 📚 Key API Modules Summary

| Module | Endpoints | Description |
|---|---|---|
| **Auth** | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | User registration, login, httpOnly cookie issuance, and profile check |
| **Posts** | `GET /api/posts`, `GET /api/posts/:slugOrId`, `POST /api/posts`, `POST /api/posts/:id/clap`, `POST /api/posts/:id/verify-password` | Story publishing, filtering, claps, and encrypted private story access |
| **Comments** | `GET /api/comments?postId=...`, `POST /api/comments`, `POST /api/comments/:id/report` | Threaded responses, nested replies, formatting, and reporting |
| **Library** | `GET /api/library/lists`, `GET /api/library/bookmarks`, `GET /api/library/highlights`, `GET /api/library/history` | Reading lists, bookmarks, text selection quotes, and reading history |
| **Reports** | `GET /api/reports`, `DELETE /api/reports/:id`, `PATCH /api/reports/:id/dismiss` | Admin response moderation queue |
| **Health** | `GET /api/health` | System memory and database health checks |
