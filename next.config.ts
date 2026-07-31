import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist ships an ESM legacy build that must be required from node_modules at
  // runtime; bundling it into the server output makes the dynamic import fail, which
  // silently downgraded source verification to "unreachable".
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
