# Flowlist — Build Plan

## Overview

A monochrome, Vercel-minimalism-inspired to-do app with fluid animations.

**Stack:** Next.js 16 · Clerk · Cloudflare D1 · TypeScript · Effect v4 · shadcn/ui · Framer Motion · OpenNext

---

## Environment

### `.env.local`

```env
# Server
PORT=4565
CLERK_SECRET_KEY=sk_test_••••••••  # real value lives in .env.local (untracked)

# Client (exposed to browser)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YXNzdXJlZC1idWxsZnJvZy04MjcuY2xlcmsuYWNjb3VudHMuZGV2JA
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

### `wrangler.toml`

```toml
name = "flowlist"
compatibility_date = "2026-10-02"

[[d1_databases]]
binding = "DB"
database_name = "flowlist-db"
database_id = "<your-d1-uuid>"
```

### `opennext.config.ts`

```ts
import { defineCloudflareConfig } from "opennextjs-cloudflare";

export default defineCloudflareConfig({
  // D1 binding auto-configured via wrangler.toml
});
```

---

## Database Schema

### `migrations/0001_init.sql`

```sql
-- Users synced from Clerk
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- Clerk user ID
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Todos
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
  completed INTEGER NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

-- Todo ↔ Tag join table
CREATE TABLE IF NOT EXISTS todo_tags (
  todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (todo_id, tag_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
CREATE INDEX IF NOT EXISTS idx_todos_sort ON todos(sort_order);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);
CREATE INDEX IF NOT EXISTS idx_todo_tags_todo ON todo_tags(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_tags_tag ON todo_tags(tag_id);
```

---

## Project Structure

```
src/
├── domain/
│   ├── todo.ts              # Todo entity, Priority type, Order type
│   ├── tag.ts               # Tag entity
│   └── user.ts              # User entity (Clerk sync)
├── schema/
│   ├── todo.ts              # TodoSchema, CreateTodoInput, UpdateTodoInput, FilterInput
│   ├── tag.ts               # TagSchema, CreateTagInput
│   └── user.ts              # UserSchema
├── services/
│   ├── Database.ts          # D1 query layer (Effect Service)
│   ├── UserService.ts       # Sync Clerk user → D1
│   ├── TodoService.ts       # CRUD + filter + sort + reorder
│   └── TagService.ts        # Tag CRUD + attach/detach
├── layers/
│   └── AppLayer.ts          # Compose all services into one Layer
├── lib/
│   ├── db.ts                # D1 client + drizzle setup
│   ├── effect.ts            # Effect Runtime, Refinements, helpers
│   └── env.ts               # Env parsing with Effect Schema
├── middleware.ts            # Clerk auth middleware
└── app/
    ├── layout.tsx           # Root layout (ClerkProvider, theme)
    ├── page.tsx             # Main to-do list page
    ├── sign-in/[[...sign-in]]/page.tsx
    ├── sign-up/[[...sign-up]]/page.tsx
    ├── api/
    │   ├── todos/
    │   │   ├── route.ts     # GET (list), POST (create)
    │   │   └── [id]/
    │   │       └── route.ts # GET, PATCH, DELETE
    │   └── tags/
    │       ├── route.ts     # GET, POST
    │       └── [id]/
    │           └── route.ts # DELETE
    └── components/
        ├── todo-list.tsx
        ├── todo-item.tsx
        ├── todo-form.tsx
        ├── tag-filter.tsx
        ├── sort-select.tsx
        └── ui/              # shadcn components
```

---

## Phases

### Phase 1: Scaffold & Setup

```bash
npx create-next-app@latest flowlist --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd flowlist
```

```bash
npm install effect @clerk/nextjs drizzle-orm drizzle-kit
npm install framer-motion
npm install -D wrangler opennextjs-cloudflare
npx shadcn@latest init
```

- Create `.env.local` with all keys
- Create `wrangler.toml` with D1 binding
- Create `opennext.config.ts`
- Run D1 migration: `wrangler d1 migrations apply flowlist-db --remote`

---

### Phase 2: Database & Domain

- Write `migrations/0001_init.sql`
- Create domain types (`src/domain/`)
- Create Effect Schemas (`src/schema/`)
- Set up D1 client (`src/lib/db.ts`)
- Set up Effect runtime (`src/lib/effect.ts`)

---

### Phase 3: Services (Effect v4)

- **Database service** — D1 query layer with Effect Service
- **UserService** — sync Clerk user ID → D1 users table (upsert on first request)
- **TodoService** — CRUD, filtering, sorting, reordering
- **TagService** — CRUD, attach/detach to todos
- **AppLayer** — compose all services

---

### Phase 4: Auth (Clerk)

- `middleware.ts` — protect routes, redirect unauthenticated
- Sign-in / sign-up pages
- On authenticated request: upsert user into D1 `users` table
- Pass `userId` to all API routes

---

### Phase 5: API Routes

- `GET /api/todos` — list with filters (status, priority, tags, sort)
- `POST /api/todos` — create
- `GET /api/todos/[id]` — get one
- `PATCH /api/todos/[id]` — update (title, description, due date, priority, completed, sort order)
- `DELETE /api/todos/[id]` — delete
- `GET /api/tags` — list user's tags
- `POST /api/tags` — create tag
- `DELETE /api/tags/[id]` — delete tag

All routes: validate input with Effect Schema, delegate to services, return typed responses.

---

### Phase 6: UI Components

- **Monochrome** — pure black bg, white/gray text, no color
- **Vercel aesthetic** — generous whitespace, `border-white/10`, small text, tight tracking
- **shadcn/ui** — Button, Input, Dialog, Checkbox, Badge, Dropdown, Tooltip, Skeleton
- **Framer Motion** — layout animations for reorder, AnimatePresence for add/remove, micro-interactions

Components:
- `todo-list.tsx` — main list with DnD
- `todo-item.tsx` — single to-do with checkbox, edit, delete
- `todo-form.tsx` — create/edit form (dialog)
- `tag-filter.tsx` — tag-based filtering
- `sort-select.tsx` — sort options

---

### Phase 7: Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `n` | New to-do |
| `j` / `k` | Navigate down/up |
| `x` | Toggle complete |
| `d` | Delete |
| `e` | Edit |
| `Esc` | Close dialog / blur |

---

### Phase 8: Animations & Polish

- Framer Motion `layout` prop for smooth reordering
- `AnimatePresence` for add/remove transitions
- Subtle scale on checkbox toggle
- Smooth dialog open/close
- Skeleton loading states
- Focus ring transitions

---

### Phase 9: Deploy

```bash
# Build with OpenNext
npx opennextjs-cloudflare build

# Deploy to Cloudflare Workers
wrangler deploy
```

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| Dev database | Remote Cloudflare D1 (no local) |
| User sync | Upsert Clerk user → D1 on each authenticated request |
| Validation | Effect Schema at API boundary |
| Error handling | Typed error channels (no exceptions) |
| React role | Rendering only — no business logic |
| Styling | Tailwind + shadcn/ui, monochrome |
| Animations | Framer Motion |
| Deployment | OpenNext → Cloudflare Workers |
| Port | 4565 (via `.env.local`) |
