"use client";

import axios from "axios";
import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ImagePlus,
  ArrowUp,
  Loader2,
  Download,
  X,
  Globe,
  Lock,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { Sora } from "next/font/google";
import { appCache } from "@/lib/cache";

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
});

interface ProgressState {
  step: string;
  progress: number;
  imageUrl?: string;
  error?: string;
}

const MAX_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function GenerationPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [images, setImages] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [imageLinks, setImageLinks] = useState<string[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  const [isPublic, setIsPublic] = useState(true);

  const [videoTitle, setVideoTitle] = useState("");
  const [externalPrompt, setExternalPrompt] = useState("");

  const [uploadError, setUploadError] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);

  const [progressState, setProgressState] = useState<ProgressState>({
    step: "",
    progress: 0,
  });

  const draftData = {
    videoTitle,
    externalPrompt,
    imageLinks,
    isPublic,
  };

  // Cleanup preview URLs
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // Auto-save drafts
  useEffect(() => {
    if (!videoTitle && !externalPrompt && imageLinks.length === 0) {
      return;
    }

    const timeout = setTimeout(() => {
      localStorage.setItem(
        "thumbnail-draft",
        JSON.stringify(draftData)
      );

      setDraftSaved(true);

      const hideTimeout = setTimeout(() => {
        setDraftSaved(false);
      }, 1500);

      return () => clearTimeout(hideTimeout);
    }, 1000);

    return () => clearTimeout(timeout);
  }, [videoTitle, externalPrompt, imageLinks, isPublic]);

  // Restore draft
  useEffect(() => {
    const savedDraft = localStorage.getItem("thumbnail-draft");

    if (savedDraft) {
      try {
        const parsedDraft = JSON.parse(savedDraft);

        setVideoTitle(parsedDraft.videoTitle || "");
        setExternalPrompt(parsedDraft.externalPrompt || "");
        setImageLinks(parsedDraft.imageLinks || []);
        setIsPublic(parsedDraft.isPublic ?? true);

        toast("Recovered previous draft");
      } catch (error) {
        console.error("Failed to restore draft:", error);
      }
    }
  }, []);

  const pollProgress = useCallback(
    async (progressId: string) => {
      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch(
            `/api/generate-thumbnail?progressId=${progressId}`
          );

          if (!response.ok) {
            if (response.status === 404) {
              toast("Session expired or progress ID is invalid.");

              clearInterval(pollInterval);

              setLoading(false);

              setProgressState({
                step: "Error",
                progress: 100,
                error: "Polling failed: Invalid ID",
              });
            }

            throw new Error(
              `Polling failed with status: ${response.status}`
            );
          }

          const progressData =
            (await response.json()) as ProgressState;

          setProgressState(progressData);

          if (progressData.imageUrl) {
            localStorage.removeItem("thumbnail-draft");

            setImages((prev) => [
              ...prev,
              progressData.imageUrl!,
            ]);

            appCache.del("my-thumbnails");
            appCache.del("explore");
            appCache.del("credits");

            toast("Thumbnail generated successfully!");

            clearInterval(pollInterval);

            setLoading(false);
          } else if (progressData.error) {
            toast(`Error: ${progressData.error}`);

            clearInterval(pollInterval);

            setLoading(false);
          }
        } catch (error) {
          console.error("Error polling progress:", error);

          toast("Error checking generation progress.");

          clearInterval(pollInterval);

          setLoading(false);

          setProgressState({
            step: "Polling Error",
            progress: 100,
            error: "Could not retrieve progress",
          });
        }
      }, 1000);

      return pollInterval;
    },
    [setImages, setLoading, setProgressState]
  );

  const uploadWithPresignedUrl = async (
    file: File
  ): Promise<string> => {
    const response = await fetch("/api/presigned-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();

      throw new Error(
        `Failed to get presigned URL: ${
          errorData.error || response.statusText
        }`
      );
    }

    const { signedUrl, fileUrl } = await response.json();

    const uploadResponse = await fetch(signedUrl, {
      method: "PUT",
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText}`
      );
    }

    return fileUrl;
  };

  const validateImage = (file: File): boolean => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError("Please upload JPG, PNG, or WEBP");
      return false;
    }

    if (file.size > MAX_SIZE) {
      setUploadError("File must be under 20MB");
      return false;
    }

    if (file.size === 0) {
      setUploadError("File is corrupted or empty");
      return false;
    }

    return true;
  };

  const processSelectedFiles = async (files: File[]) => {
    setUploadError("");

    if (files.length === 0) return;

    if (files.length > 5) {
      setUploadError("You can upload up to 5 images.");
      return;
    }

    for (const file of files) {
      const isValid = validateImage(file);

      if (!isValid) return;
    }

    try {
      setUploading(true);

      setSelectedFiles(files);

      previewUrls.forEach((url) =>
        URL.revokeObjectURL(url)
      );

      const urls = files.map((file) =>
        URL.createObjectURL(file)
      );

      setPreviewUrls(urls);

      const uploadedLinks = await Promise.all(
        files.map((file) =>
          uploadWithPresignedUrl(file)
        )
      );

      setImageLinks(uploadedLinks);
    } catch (error) {
      console.error(
        "Error uploading selected files:",
        error
      );

      setUploadError(
        "Failed to upload one or more images."
      );

      setSelectedFiles([]);
      setImageLinks([]);
      setPreviewUrls([]);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files
      ? Array.from(e.target.files)
      : [];

    await processSelectedFiles(files);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();

    setIsDragging(false);

    const files = Array.from(
      e.dataTransfer.files
    ).filter((f) => f.type.startsWith("image/"));

    if (files.length === 0) {
      toast("Please drop image files only.");
      return;
    }

    await processSelectedFiles(files);
  };

  const clearImages = () => {
    previewUrls.forEach((url) =>
      URL.revokeObjectURL(url)
    );

    setSelectedFiles([]);
    setImageLinks([]);
    setPreviewUrls([]);
    setUploadError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  async function handleClick() {
    setLoading(true);

    setProgressState({
      step: "Initializing...",
      progress: 0,
    });

    if (!videoTitle.trim()) {
      toast("Please enter the video title.");

      setLoading(false);

      setProgressState({
        step: "",
        progress: 0,
      });

      return;
    }

    if (!externalPrompt.trim()) {
      toast("Please enter an external prompt.");

      setLoading(false);

      setProgressState({
        step: "",
        progress: 0,
      });

      return;
    }

    try {
      const basicPrompt = [
        `Video title: ${videoTitle.trim()}`,
        `External prompt: ${externalPrompt.trim()}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await axios.post(
        "/api/generate-thumbnail",
        {
          basicPrompt,
          videoTitle: videoTitle.trim(),
          externalPrompt: externalPrompt.trim(),
          isPublic,
          image_url: imageLinks[0],
          image_urls:
            imageLinks.length > 0
              ? imageLinks
              : undefined,
        }
      );

      if (response.data.progressId) {
        pollProgress(response.data.progressId);
      } else if (response.data.error) {
        toast(
          response.data.message ||
            "Failed to start generation."
        );

        setLoading(false);

        setProgressState({
          step: "",
          progress: 0,
        });
      }
    } catch (error: unknown) {
      console.error("Generation error:", error);

      toast("Failed to initiate thumbnail generation.");

      setLoading(false);

      setProgressState({
        step: "",
        progress: 0,
      });
    }
  }

  return (
    <div className="w-full min-h-full">
      <div className="max-w-3xl mx-auto px-4 pt-12 md:pt-20 pb-12">
        {/* Header */}
        <div className="text-center mb-8">
          <h1
            className={`text-3xl md:text-4xl font-bold tracking-tight ${sora.className}`}
          >
            Describe your thumbnail.
          </h1>

          <p className="text-muted-foreground mt-2">
            AI turns your words into click-worthy visuals.
          </p>

          {draftSaved && (
            <p className="text-sm text-green-500 mt-2">
              Draft Saved
            </p>
          )}
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Video Title
            </label>
            <Input
              placeholder="Enter video title..."
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.target.value)}
              disabled={loading || uploading}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Prompt
            </label>
            <Textarea
              placeholder="Describe what you want in the thumbnail..."
              value={externalPrompt}
              onChange={(e) => setExternalPrompt(e.target.value)}
              rows={4}
              disabled={loading || uploading}
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className="text-sm font-medium mb-2 block">
              Reference Images (optional)
            </label>
            
            {selectedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {previewUrls.map((url, index) => (
                  <div key={index} className="relative">
                    <Image
                      src={url}
                      alt={`Preview ${index + 1}`}
                      width={80}
                      height={80}
                      className="rounded-md object-cover"
                    />
                    <button
                      onClick={clearImages}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      disabled={loading || uploading}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-muted/50"
                  : "border-border hover:border-border/80"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_TYPES.join(",")}
                multiple
                onChange={handleFileChange}
                className="hidden"
                disabled={loading || uploading}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || uploading}
                className="flex items-center justify-center gap-2 w-full"
              >
                <ImagePlus size={16} />
                <span>Upload reference images</span>
              </button>
            </div>
            
            {uploadError && (
              <p className="text-sm text-destructive mt-2">{uploadError}</p>
            )}
          </div>

          {/* Visibility Toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPublic(!isPublic)}
              className="flex items-center gap-1 text-sm"
              disabled={loading || uploading}
            >
              {isPublic ? <Globe size={16} /> : <Lock size={16} />}
              <span>{isPublic ? "Public" : "Private"}</span>
            </button>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleClick}
            disabled={loading || uploading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <ArrowUp size={16} className="mr-2" />
                Generate Thumbnail
              </>
            )}
          </Button>
        </div>

        {/* Progress */}
        {progressState.step && (
          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">{progressState.step}</span>
            </div>
            <div className="w-full bg-border rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all" 
                style={{ width: `${progressState.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Generated Images */}
        {images.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-4">Generated Thumbnails</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {images.map((image, index) => (
                <div key={index} className="relative rounded-lg overflow-hidden border">
                  <Image
                    src={image}
                    alt={`Generated ${index + 1}`}
                    width={1024}
                    height={576}
                    className="w-full"
                  />
                  <Link
                    href={image}
                    target="_blank"
                    className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full"
                  >
                    <Download size={16} />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}