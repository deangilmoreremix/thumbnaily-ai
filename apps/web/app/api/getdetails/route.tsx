// API endpoint for getting thumbnail details
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { thumbnailid } = await req.json();

  // Get thumbnail without user join for anonymous usage
  const { data: thumbnail, error } = await supabaseAdmin
    .from('thumbnails')
    .select('*')
    .eq('id', thumbnailid)
    .single();

  if (error || !thumbnail) {
    return NextResponse.json({
      error: "Data not found."
    }, { status: 404 });
  }

  // Transform to match expected format
  const transformedData = {
    data: {
      prompt: thumbnail.prompt,
      link: thumbnail.image_url || '',
      createdAt: thumbnail.created_at,
    },
    user: {
      name: 'Anonymous',
      avatar: '',
    },
  };

  return NextResponse.json(transformedData);
}