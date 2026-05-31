// API endpoint using Supabase Storage for direct uploads
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const BUCKET_NAME = 'thumbnails';

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
      if (fileType.includes('gif')) return 'gif';
      
      // Fallback to fileName extension
      const ext = fileName.split('.').pop()?.toLowerCase();
      return ext || 'jpeg';
    };

    const fileExtension = getFileExtension(fileName, fileType);
    const path = `thumbnails/uploads/${Math.floor(Math.random() * 1000) + Date.now().toString()}.${fileExtension}`;

    // Generate a signed upload URL using Supabase admin
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(path, {
        contentType: fileType,
      });

    if (signedUrlError) {
      throw new Error(signedUrlError.message);
    }

    const fileUrl = `https://bzxohkrxcwodllketcpz.supabase.co/storage/v1/object/public/${BUCKET_NAME}/${path}`;

    return NextResponse.json({ 
      signedUrl: signedUrlData.signedUrl,
      fileUrl: fileUrl, 
      path,
      token: signedUrlData.token,
    });
  } catch (error) {
    console.error('Error processing upload request:', error);
    return NextResponse.json({ 
      error: 'Failed to process upload request', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}