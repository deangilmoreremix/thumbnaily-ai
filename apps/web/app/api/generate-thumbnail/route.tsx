// api/generate-thumbnail/route.ts
import { NextRequest, NextResponse } from "next/server";
import { enhancePrompt } from "@/lib/enhancePrompt";
import { muApiClient, MuApiImageResponse, MuApiVideoResponse } from "@/lib/muapi";
import { supabaseAdmin } from "@/lib/supabase";

interface ProgressData {
  step: string;
  progress: number;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
  generationType?: 'image' | 'video';
}

const progressStore = new Map<string, ProgressData>();
const BUCKET_NAME = 'thumbnails';

const updateProgress = (
  progressId: string,
  step: string,
  progress: number,
  data?: Partial<Omit<ProgressData, 'step' | 'progress'>>,
) => {
  progressStore.set(progressId, { 
    step, 
    progress, 
    ...data,
  } as ProgressData);
};

export async function POST(req: NextRequest) {
  const progressId = Math.random().toString(36).substring(7);
  updateProgress(progressId, "Initializing", 0);

  try {
    const { basicPrompt, image_url, image_urls, isPublic, generationType = 'image' } = await req.json();
    const publicFlag = typeof isPublic === "boolean" ? isPublic : true;

    // Normalise image URLs: prefer the array, fall back to single, default empty
    const imageUrls: string[] = Array.isArray(image_urls)
      ? image_urls.filter((u): u is string => typeof u === "string" && Boolean(u))
      : image_url
        ? [image_url]
        : [];

    if (imageUrls.length > 5) {
      updateProgress(progressId, "Error", 15, { error: "Max 5 reference images allowed" });
      return NextResponse.json(
        { error: true, message: "You can upload up to 5 reference images", progressId },
        { status: 400 }
      );
    }

    if (!basicPrompt) {
      updateProgress(progressId, "Error", 15, { error: "Prompt is missing" });
      return NextResponse.json(
        { error: true, message: "Prompt is required", progressId },
        { status: 400 }
      );
    }

    updateProgress(progressId, "Request accepted", 15);

    // Start async generation
    (async () => {
      try {
        updateProgress(progressId, "Enhancing prompt", 25);

        const enhancedPromptResponse = await enhancePrompt(basicPrompt, imageUrls);
        if (!enhancedPromptResponse) {
          throw new Error("Failed to enhance prompt: empty response");
        }
        const { prompt: enhancedContent, style, mood } = JSON.parse(enhancedPromptResponse);
        if (!enhancedContent) {
          throw new Error("Failed to parse enhanced prompt");
        }
        
        // Combine style and mood into the prompt
        const finalPrompt = `[Style: ${style || 'cinematic'}, Mood: ${mood || 'dramatic'}] ${enhancedContent}`;
        updateProgress(progressId, "Prompt enhanced", 35);

        updateProgress(progressId, "Initializing AI generation", 45);

        let result: MuApiImageResponse | MuApiVideoResponse;
        let fileExtension = '.png';
        let contentType = 'image/png';

        if (generationType === 'video') {
          updateProgress(progressId, "Generating video", 50);
          result = await muApiClient.generateVideo({
            prompt: finalPrompt,
            duration: 5,
            width: 1024,
            height: 576,
            output_format: 'mp4',
          }) as MuApiVideoResponse;
          fileExtension = '.mp4';
          contentType = 'video/mp4';
        } else {
          updateProgress(progressId, "Generating image", 50);
          
          if (imageUrls.length > 0) {
            result = await muApiClient.generateImageWithReference(
              finalPrompt,
              imageUrls,
              { width: 1024, height: 576, steps: 30, output_format: 'png' }
            ) as MuApiImageResponse;
          } else {
            result = await muApiClient.generateImage({
              prompt: finalPrompt,
              width: 1024,
              height: 576,
              steps: 30,
              output_format: 'png',
            }) as MuApiImageResponse;
          }
        }

        if (generationType === 'video') {
          if (!result || !(result as MuApiVideoResponse).video_url) {
            throw new Error("Video generation failed or returned no output URL");
          }
        } else {
          if (!result || !(result as MuApiImageResponse).images?.[0]?.url) {
            throw new Error("Image generation failed or returned no output URL");
          }
        }

        const outputUrl = generationType === 'video' 
          ? (result as MuApiVideoResponse).video_url! 
          : ((result as MuApiImageResponse).images![0] as { url: string }).url;
        updateProgress(progressId, "AI generation complete", 75);

        updateProgress(progressId, "Downloading generated content", 80);
        const mediaResponse = await fetch(outputUrl);
        if (!mediaResponse.ok) {
          throw new Error(`Failed to download generated content: ${mediaResponse.statusText}`);
        }
        const mediaBuffer = await mediaResponse.arrayBuffer();

        updateProgress(progressId, "Uploading to cloud storage", 85);
        
        const key = `thumbnails/generations/${Date.now().toString()}_${Math.floor(Math.random() * 1000)}${fileExtension}`;
        
        const { error: uploadError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .upload(key, Buffer.from(mediaBuffer), {
            contentType,
            upsert: false,
          });

        if (uploadError) {
          throw new Error(`Failed to upload to Supabase Storage: ${uploadError.message}`);
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from(BUCKET_NAME)
          .getPublicUrl(key);

        const finalUrl = publicUrlData.publicUrl;
        updateProgress(progressId, "Cloud upload complete", 90);
        updateProgress(progressId, "Complete", 100, generationType === 'video' 
          ? { videoUrl: finalUrl, generationType } 
          : { imageUrl: finalUrl, generationType: 'image' }
        );
        console.log("Done");
      } catch (e: unknown) {
        console.error("Background generation error:", e);
        const errorMessage =
          e instanceof Error ? e.message : "Unknown error during generation";
        updateProgress(progressId, "Error", 100, { error: errorMessage });
      } finally {
        setTimeout(() => progressStore.delete(progressId), 60000);
      }
    })();

    return NextResponse.json({ progressId });
  } catch (e: unknown) {
    console.error("Initial request processing error:", e);
    const errorMessage =
      e instanceof Error ? e.message : "Failed to process request";
    updateProgress(progressId, "Error", 0, { error: `Initial error: ${errorMessage}` });
    return NextResponse.json(
      { error: true, message: errorMessage, progressId },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const progressId = url.searchParams.get("progressId");

  if (!progressId) {
    return NextResponse.json(
      { error: "Progress ID is required" },
      { status: 400 }
    );
  }
  if (!progressStore.has(progressId)) {
    return NextResponse.json(
      { error: "Invalid or expired progress ID" },
      { status: 404 }
    );
  }

  return NextResponse.json(progressStore.get(progressId));
}