import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAuth } from "@/lib/api";
import { TodoService } from "@/layers/AppLayer";
import { ReorderSchema } from "@/schema/todo";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(ReorderSchema)(body);
  if (Option.isNone(decoded)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const todos = yield* TodoService;
      yield* todos.reorder(userId, decoded.value.orderedIds);
      return NextResponse.json({ success: true });
    })
  );
}
