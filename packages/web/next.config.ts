import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // We serve on 127.0.0.1 (Supabase auth redirects use it); allow dev assets.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
