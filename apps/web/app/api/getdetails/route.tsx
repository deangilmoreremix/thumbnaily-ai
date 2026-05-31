// API endpoint for getting thumbnail details
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { thumbnailid } = await req.json();

  // Get thumbnail with creator info
  const { data: thumbnail } = await supabaseAdmin
    .from('thumbnails')
    .select(`*, users!inner(name, avatar)`)
    .eq('id', thumbnailid)
    .single();

  if (!thumbnail) {
    return NextResponse.json({
      error: "Data not found."
    }, { status: 404 });
  }

  // Transform to match expected format
  const transformedData = {
    data: {
      prompt: thumbnail.prompt,
      link: thumbnail.link,
      createdAt: thumbnail.created_at,
    },
    user: {
      name: thumbnail.users?.name || 'Anonymous',
      avatar: thumbnail.users?.avatar || '',
    },
  };

  return NextResponse.json(transformedData);
}