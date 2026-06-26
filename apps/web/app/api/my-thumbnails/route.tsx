import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit")) || 24, 60);

  // Return every completed thumbnail (public + private). No isPublic filter.
  let query = supabase
    .from("thumbnails")
    .select(
      "id, link, prompt, createdAt, isPublic, size, quality, format, mode, parent_id"
    )
    .order("createdAt", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt("id", cursor);
  }

  const { data: thumbnails, error } = await query;

  if (error) {
    console.error("Failed to fetch my-thumbnails:", error);
    return NextResponse.json(
      { error: "Failed to fetch thumbnails" },
      { status: 500 }
    );
  }

  const hasMore = (thumbnails?.length ?? 0) > limit;
  const data = hasMore ? thumbnails?.slice(0, limit) : thumbnails;
  const nextCursor = hasMore && data ? data[data.length - 1]!.id : null;

  return NextResponse.json({ data, nextCursor });
}
