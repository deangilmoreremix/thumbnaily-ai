import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit")) || 15, 50);

  let query = supabaseAdmin
    .from('thumbnails')
    .select(`*, thumbnail_reference_images(*)`)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  // Cursor-based pagination
  if (cursor) {
    query = query.lt('id', cursor);
  }

  const { data: thumbnails, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const hasMore = thumbnails && thumbnails.length > limit;
  const data = hasMore ? thumbnails?.slice(0, limit) : thumbnails;
  const nextCursor = hasMore ? data?.[data.length - 1]?.id : null;

  // Transform data to match expected format
  const transformedData = data?.map((thumb) => ({
    id: thumb.id,
    prompt: thumb.prompt,
    link: thumb.link,
    isPublic: thumb.is_public,
    createdAt: thumb.created_at,
    referenceImages: thumb.thumbnail_reference_images || [],
  })) || [];

  return NextResponse.json({ data: transformedData, nextCursor });
}