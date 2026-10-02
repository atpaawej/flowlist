import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAgentAuth } from "@/lib/agent-auth";
import { TodoService } from "@/layers/AppLayer";
import { UpdateTodoSchema } from "@/schema/todo";

type Params = { params: Promise<{ id: string }> };

/**
 * Agent surface for a single todo. Every call is scoped by the `userId` the
 * guard resolved from the token, so an agent can only ever reach its own human's
 * todos — the service layer takes `userId` as its first argument on every query.
 */

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const todo = yield* todos.get(userId, id);
      if (!todo) {
        return NextResponse.json(
          { code: "NOT_FOUND", error: "To-do not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ todo });
    })
  );
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(UpdateTodoSchema)(body);
  if (Option.isNone(decoded)) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", error: "Invalid input" },
      { status: 400 }
    );
  }

  const input = decoded.value;
  if (input.title !== undefined && !input.title.trim()) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", error: "Title is required" },
      { status: 400 }
    );
  }

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      const updated = yield* todos.update(userId, id, {
        ...input,
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      });
      return NextResponse.json({ todo: updated });
    })
  );
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      yield* todos.remove(userId, id);
      return NextResponse.json({ success: true });
    })
  );
}
