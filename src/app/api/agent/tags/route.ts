import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAgentAuth } from "@/lib/agent-auth";
import { TagService } from "@/layers/AppLayer";
import { CreateTagSchema } from "@/schema/tag";

/**
 * Agent surface for tags. Wrapped responses and `{ code, error }` failures, as
 * documented in `auth.md`.
 *
 * Creating a tag that already exists returns the existing one with a 200, the
 * same idempotent behaviour as `/api/tags` — an agent retrying a create should
 * not end up with two tags called "work".
 */
export async function GET(request: NextRequest) {
  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const tags = yield* TagService;
      const list = yield* tags.list(userId);
      return NextResponse.json({ tags: list });
    })
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(CreateTagSchema)(body);
  if (Option.isNone(decoded)) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", error: "Invalid input" },
      { status: 400 }
    );
  }

  const name = decoded.value.name.trim();
  if (!name) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", error: "Name is required" },
      { status: 400 }
    );
  }

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const tags = yield* TagService;
      const existing = yield* tags.list(userId);
      const clash = existing.find(
        (t) => t.name.toLowerCase() === name.toLowerCase()
      );
      if (clash) {
        return NextResponse.json({ tag: clash });
      }
      const created = yield* tags.create(userId, name);
      return NextResponse.json({ tag: created }, { status: 201 });
    })
  );
}
