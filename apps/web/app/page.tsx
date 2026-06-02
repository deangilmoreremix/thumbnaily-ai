import Footer from "@/components/Footer";
import LandingPage from "@/components/LandingPage";
import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";

async function getLatestThumbnails() {
  try {
    const { data: thumbnails, error } = await supabase
      .from("thumbnails")
      .select("link")
      .eq("isPublic", true)
      .order("createdAt", { ascending: false })
      .limit(12);
    
    if (error) {
      console.error("Error fetching thumbnails:", error);
      return [];
    }
    
    return thumbnails?.map((t) => t.link) ?? [];
  } catch {
    return [];
  }
}

export default async function Home() {
  const thumbnailUrls = await getLatestThumbnails();

  return (
    <>
      <Navbar />
      <LandingPage thumbnailUrls={thumbnailUrls} />
      <Footer />
    </>
  );
}
