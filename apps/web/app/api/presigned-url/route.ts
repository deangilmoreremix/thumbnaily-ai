import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const { fileName, fileType, fileSize } = await request.json();

    if (
      !fileName ||
      !fileType ||
      typeof fileSize !== "number" ||
      !Number.isFinite(fileSize)
    ) {
      return NextResponse.json(
        { error: "fileName, fileType and valid fileSize are required" },
        { status: 400 }
      );
    }

    const MAX_SIZE = 20 * 1024 * 1024; // 20MB
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

    if (!ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: "Invalid file type. Please upload JPG, PNG, or WEBP" }, { status: 400 });
    }

    if (fileSize > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 20MB" }, { status: 400 });
    }

    // Get proper file extension from fileType or fileName
    const getFileExtension = (fileName: string, fileType: string) => {
      if (fileType.includes('jpeg') || fileType.includes('jpg')) return 'jpeg';
      if (fileType.includes('png')) return 'png';
      if (fileType.includes('webp')) return 'webp';
      
      const ext = fileName.split('.').pop()?.toLowerCase();
      return ext || 'jpeg';
    };

    const fileExtension = getFileExtension(fileName, fileType);
    const key = `thumbnails/uploads/${Date.now()}-${Math.floor(Math.random() * 1000)}.${fileExtension}`;

    // For Supabase storage, we return the upload URL and key
    // The client will use supabase-js to upload directly
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from("thumbnails")
      .createSignedUploadUrl(key);

    if (signedUrlError) {
      return NextResponse.json({ 
        error: 'Failed to generate upload URL', 
        details: signedUrlError.message 
      }, { status: 500 });
    }

    const fileUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbnails/${key}`;

    return NextResponse.json({ 
      signedUrl: signedUrlData.signedUrl, 
      token: signedUrlData.token,
      fileUrl, 
      key 
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    return NextResponse.json({ 
      error: 'Failed to generate upload URL', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}