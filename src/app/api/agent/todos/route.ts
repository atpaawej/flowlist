import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAgentAuth } from "@/lib/agent-auth";
import { TodoService } from "@/layers/AppLayer";
import { CreateTodoSchema } from "@/schema/todo";
import type { Priority, SortOption } from "@/domain/todo";

/**
 * Agent surface for todos. Mirrors `/api/todos` with two deliberate
 * differences, both documented in `auth.md`:
 *
 * - List responses are wrapped (`{ todos: [...] }`) and take a `limit`, so a
 *   future cursor fits inside the envelope instead of breaking agents parsing
 *   a bare array. The human route keeps returning a bare, unpaginated array.
 * - Errors are `{ code, error }` rather than `{ error }`, so an agent can
 *   branch without parsing prose.
 */

const priorities = new Set(["low", "medium", "high"]);
const sortOptions = new Set(["custom", "priority", "dueDate", "createdAt"]);
const statuses = new Set(["active", "completed", "all"]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Clamps a `limit` query param into `[1, MAX_LIMIT]`, ignoring garbage. */
function parseLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

const badRequest = () =>
  NextResponse.json(
    { code: "INVALID_REQUEST", error: "Invalid input" },
    { status: 400 }
  );

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const statusParam = searchParams.get("status");
  const priorityParam = searchParams.get("priority");
  const sortParam = searchParams.get("sortBy");
  const tagParam = searchParams.get("tag");
  const limit = parseLimit(searchParams.get("limit"));

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const all = yield* todos.list(userId, {
        status:
          statusParam && statuses.has(statusParam)
            ? (statusParam as "active" | "completed" | "all")
            : undefined,
        priority:
          priorityParam && priorities.has(priorityParam)
            ? (priorityParam as Priority)
            : undefined,
        sortBy:
          sortParam && sortOptions.has(sortParam)
            ? (sortParam as SortOption)
            : undefined,
        tag: tagParam ?? undefined,
      });
      return NextResponse.json({ todos: all.slice(0, limit) });
    })
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(CreateTodoSchema)(body);
  if (Option.isNone(decoded)) return badRequest();

  const input = decoded.value;
  if (!input.title.trim()) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", error: "Title is required" },
      { status: 400 }
    );
  }

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const created = yield* todos.create(userId, {
        ...input,
        title: input.title.trim(),
      });
      return NextResponse.json({ todo: created }, { status: 201 });
    })
  );
}
