import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAuth } from "@/lib/api";
import { TodoService } from "@/layers/AppLayer";
import { UpdateTodoSchema } from "@/schema/todo";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const todo = yield* todos.get(userId, id);
      if (!todo) {
        return NextResponse.json({ error: "To-do not found" }, { status: 404 });
      }
      return NextResponse.json(todo);
    })
  );
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(UpdateTodoSchema)(body);
  if (Option.isNone(decoded)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const input = decoded.value;
  if (input.title !== undefined && !input.title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const updated = yield* todos.update(userId, id, {
        ...input,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      });
      return NextResponse.json(updated);
    })
  );
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      yield* todos.remove(userId, id);
      return NextResponse.json({ success: true });
    })
  );
}
