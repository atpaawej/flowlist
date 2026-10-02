import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAuth } from "@/lib/api";
import { TodoService } from "@/layers/AppLayer";
import { CreateTodoSchema } from "@/schema/todo";
import type { Priority, SortOption } from "@/domain/todo";

const priorities = new Set(["low", "medium", "high"]);
const sortOptions = new Set(["custom", "priority", "dueDate", "createdAt"]);
const statuses = new Set(["active", "completed", "all"]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const statusParam = searchParams.get("status");
  const priorityParam = searchParams.get("priority");
  const sortParam = searchParams.get("sortBy");
  const tagParam = searchParams.get("tag");

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const list = yield* todos.list(userId, {
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
      return NextResponse.json(list);
    })
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(CreateTodoSchema)(body);
  if (Option.isNone(decoded)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const input = decoded.value;
  if (!input.title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const created = yield* todos.create(userId, {
        ...input,
        title: input.title.trim(),
      });
      return NextResponse.json(created, { status: 201 });
    })
  );
}
