import Footer from "@/components/Footer";
import LandingPage from "@/components/LandingPage";
import Navbar from "@/components/Navbar";
import { supabaseAdmin } from "@/lib/supabase";

async function getLatestThumbnails() {
  try {
    const { data: thumbnails } = await supabaseAdmin
      .from('thumbnails')
      .select('image_url')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(12);
    
    return thumbnails?.map((t) => t.image_url).filter(Boolean) || [];
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
