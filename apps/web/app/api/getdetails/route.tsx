import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  let thumbnailid: string;
  try {
    const body = (await req.json()) as { thumbnailid?: string };
    thumbnailid = body.thumbnailid ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!thumbnailid) {
    return NextResponse.json({ error: "thumbnailid is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("thumbnails")
    .select("*")
    .eq("id", thumbnailid)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Data not found." }, { status: 404 });
  }

  let parent: Record<string, unknown> | null = null;
  if (data.parent_id) {
    const { data: parentRow } = await supabase
      .from("thumbnails")
      .select("id, link, prompt, createdAt, mode")
      .eq("id", data.parent_id as string)
      .single();
    parent = parentRow;
  }

  // Family tree: load all siblings + children of the root
  const rootId = (data.parent_id as string | null) ?? (data.id as string);
  const { data: family } = await supabase
    .from("thumbnails")
    .select(
      "id, link, prompt, createdAt, mode, parent_id, caption, critic_score, mood, palette, tags, style, template"
    )
    .or(`parent_id.eq.${rootId},id.eq.${rootId}`)
    .order("createdAt", { ascending: true });

  // Channel variants for this thumbnail
  const { data: channels } = await supabase
    .from("channel_variants")
    .select("id, platform, size, link")
    .eq("thumbnail_id", thumbnailid)
    .order("createdAt", { ascending: true });

  return NextResponse.json({
    data,
    parent,
    variations: family ?? [],
    rootId,
    channels: channels ?? [],
    user: { name: "Anonymous", avatar: null },
  });
}