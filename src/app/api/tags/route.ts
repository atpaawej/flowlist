import { NextRequest, NextResponse } from "next/server";
import { Effect, Option, Schema } from "effect";
import { withAuth } from "@/lib/api";
import { TagService } from "@/layers/AppLayer";
import { CreateTagSchema } from "@/schema/tag";

export async function GET() {
  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const tags = yield* TagService;
      const list = yield* tags.list(userId);
      return NextResponse.json(list);
    })
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const decoded = Schema.decodeUnknownOption(CreateTagSchema)(body);
  if (Option.isNone(decoded)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const name = decoded.value.name.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const tags = yield* TagService;
      const existing = yield* tags.list(userId);
      const clash = existing.find(
        (t) => t.name.toLowerCase() === name.toLowerCase()
      );
      if (clash) {
        return NextResponse.json(clash);
      }
      const created = yield* tags.create(userId, name);
      return NextResponse.json(created, { status: 201 });
    })
  );
}
