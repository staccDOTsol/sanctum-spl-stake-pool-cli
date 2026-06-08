import HeroSection from "@/components/HeroSection";
import TrendingFeed from "@/components/TrendingFeed";

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
      <HeroSection />

      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-bold text-white">
          Discover
          <span className="ml-2 text-white/30 font-normal text-sm">live pool data</span>
        </h2>
      </div>

      <TrendingFeed />
    </div>
  );
}
