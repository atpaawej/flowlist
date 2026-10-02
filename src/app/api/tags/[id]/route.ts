import { NextRequest, NextResponse } from "next/server";
import { Effect } from "effect";
import { withAuth } from "@/lib/api";
import { TagService } from "@/layers/AppLayer";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withAuth(({ userId }) =>
    Effect.gen(function* () {
      const tags = yield* TagService;
      yield* tags.remove(userId, id);
      return NextResponse.json({ success: true });
    })
  );
}
