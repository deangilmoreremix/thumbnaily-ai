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

  // Load parent (root) reference if this is a refinement
  let parent: Record<string, unknown> | null = null;
  if (data.parent_id) {
    const { data: parentRow } = await supabase
      .from("thumbnails")
      .select("id, link, prompt, createdAt")
      .eq("id", data.parent_id as string)
      .single();
    parent = parentRow;
  }

  // Load variations (siblings + children)
  const { data: variations } = await supabase
    .from("thumbnails")
    .select("id, link, prompt, createdAt, mode, parent_id")
    .or(`parent_id.eq.${thumbnailid},id.eq.${data.parent_id ?? "00000000-0000-0000-0000-000000000000"}`)
    .neq("id", thumbnailid)
    .order("createdAt", { ascending: true });

  // Root id for the family
  const rootId = (data.parent_id as string | null) ?? (data.id as string);

  return NextResponse.json({
    data,
    parent,
    variations: variations ?? [],
    rootId,
    user: { name: "Anonymous", avatar: null },
  });
}
