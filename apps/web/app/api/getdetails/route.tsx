import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { thumbnailid } = await req.json();

  const { data, error } = await supabase
    .from("thumbnails")
    .select(`*, referenceImages(*)`)
    .eq("id", thumbnailid)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Data not found." }, { status: 404 });
  }

  // Since there's no user auth now, just return the thumbnail data
  // The creator info is not available without auth
  return NextResponse.json({ 
    data, 
    user: { name: "Anonymous", avatar: null } 
  });
}