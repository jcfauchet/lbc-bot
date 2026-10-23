import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.leboncoin.fr',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  serverExternalPackages: ['@sparticuz/chromium', 'playwright-core', 'sharp'],
  // sharp's libvips shared library is loaded at runtime, so file tracing misses it
  // under pnpm's layout and the function crashed with "libvips-cpp.so not found".
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/.pnpm/@img+sharp-*/**/*', './node_modules/@img/**/*'],
  },
}

export default nextConfig


