import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit")) || 15, 50);
  const mood = searchParams.get("mood");
  const palette = searchParams.get("palette");
  const tag = searchParams.get("tag");
  const search = searchParams.get("q");

  let query = supabase
    .from("thumbnails")
    .select(
      "id, link, prompt, createdAt, size, quality, format, mode, parent_id, tags, mood, palette, subject, critic_score"
    )
    .eq("isPublic", true)
    .order("createdAt", { ascending: false })
    .limit(limit + 1);

  if (cursor) query = query.lt("id", cursor);
  if (mood && mood !== "all") query = query.eq("mood", mood);
  if (palette && palette !== "all") query = query.eq("palette", palette);
  if (tag && tag !== "all") query = query.contains("tags", [tag]);
  if (search && search.trim()) {
    const term = search.trim();
    query = query.or(
      `prompt.ilike.%${term}%,revised_prompt.ilike.%${term}%,subject.ilike.%${term}%`
    );
  }

  const { data: thumbnails, error } = await query;

  if (error) {
    console.error("Error fetching thumbnails:", error);
    return NextResponse.json({ error: "Failed to fetch thumbnails" }, { status: 500 });
  }

  const hasMore = (thumbnails?.length ?? 0) > limit;
  const data = hasMore ? thumbnails?.slice(0, limit) : thumbnails;
  const nextCursor = hasMore && data ? data[data.length - 1]!.id : null;

  // Aggregate filter options from public data (cached briefly on the client).
  // Cheap query: just distinct mood/palette/tags from last 200 public rows.
  const { data: facets } = await supabase
    .from("thumbnails")
    .select("mood, palette, tags")
    .eq("isPublic", true)
    .not("mood", "is", null)
    .order("createdAt", { ascending: false })
    .limit(200);

  const moodSet = new Set<string>();
  const paletteSet = new Set<string>();
  const tagSet = new Set<string>();
  for (const f of facets ?? []) {
    if (f.mood) moodSet.add(f.mood as string);
    if (f.palette) paletteSet.add(f.palette as string);
    for (const t of (f.tags as string[] | null) ?? []) tagSet.add(t);
  }

  return NextResponse.json({
    data,
    nextCursor,
    facets: {
      moods: Array.from(moodSet).sort(),
      palettes: Array.from(paletteSet).sort(),
      tags: Array.from(tagSet).sort().slice(0, 50),
    },
  });
}