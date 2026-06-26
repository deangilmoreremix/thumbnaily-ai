import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit")) || 15, 50);

  let query = supabase
    .from("thumbnails")
    .select("id, link, prompt, createdAt, size, quality, format, mode, parent_id")
    .eq("isPublic", true)
    .order("createdAt", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.lt("id", cursor);
  }

  const { data: thumbnails, error } = await query;

  if (error) {
    console.error("Error fetching thumbnails:", error);
    return NextResponse.json({ error: "Failed to fetch thumbnails" }, { status: 500 });
  }

  const hasMore = (thumbnails?.length ?? 0) > limit;
  const data = hasMore ? thumbnails?.slice(0, limit) : thumbnails;
  const nextCursor = hasMore && data ? data[data.length - 1]!.id : null;

  return NextResponse.json({ data, nextCursor });
}