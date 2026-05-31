import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit")) || 15, 50);

  let query = supabaseAdmin
    .from('thumbnails')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  // Cursor-based pagination
  if (cursor) {
    query = query.lt('id', cursor);
  }

  const { data: thumbnails, error } = await query;

  if (error) {
    // Return empty array if table doesn't exist yet
    console.error("Database error:", error.message);
    return NextResponse.json({ data: [], nextCursor: null });
  }

  const hasMore = thumbnails && thumbnails.length > limit;
  const data = hasMore ? thumbnails?.slice(0, limit) : thumbnails;
  const nextCursor = hasMore ? data?.[data.length - 1]?.id : null;

  // Transform data to match expected format
  const transformedData = data?.map((thumb) => ({
    id: thumb.id,
    prompt: thumb.prompt,
    link: thumb.image_url || thumb.link,
    isPublic: thumb.is_public,
    createdAt: thumb.created_at,
  })) || [];

  return NextResponse.json({ data: transformedData, nextCursor });
}