import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Vercel Blob CDN
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Allow any HTTPS image for token thumbnails
      { protocol: "https", hostname: "**" },
    ],
  },
  // Vercel Blob requires the body to not be consumed by Next.js
  serverExternalPackages: ["@vercel/blob"],
};

export default nextConfig;
