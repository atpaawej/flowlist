import { NextRequest, NextResponse } from "next/server";
import { Effect } from "effect";
import { withAgentAuth } from "@/lib/agent-auth";
import { TagService } from "@/layers/AppLayer";

type Params = { params: Promise<{ id: string }> };

/**
 * Deletes a tag. Scoped to the caller's own tags by the service layer; deleting
 * a tag removes its links to todos but never the todos themselves.
 *
 * Note this is a hard delete with no soft-delete fallback and no record of who
 * performed it — an agent calling this is indistinguishable from the human, and
 * a deleted tag cannot be restored through the API.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;

  return withAgentAuth(request, ({ userId }) =>
    Effect.gen(function* () {
      const tags = yield* TagService;
      yield* tags.remove(userId, id);
      return NextResponse.json({ success: true });
    })
  );
}
