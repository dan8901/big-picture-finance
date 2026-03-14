import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
  env: {
    NEXT_PUBLIC_FORK_OWNER: process.env.VERCEL_GIT_REPO_OWNER ?? "",
    NEXT_PUBLIC_FORK_REPO: process.env.VERCEL_GIT_REPO_SLUG ?? "",
  },
};

export default nextConfig;
