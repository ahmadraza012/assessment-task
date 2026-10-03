import type { NextConfig } from 'next';
import path from 'path';

/** Runtime module for the provided engine (not type-checked — see src/callEngine.d.ts). */
const engineSource = path.join(process.cwd(), 'src/callEngine.ts');

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  turbopack: {
    resolveAlias: {
      '@engine': engineSource,
    },
  },
  webpack: (config) => {
    config.resolve ??= {};
    const alias = config.resolve.alias;
    if (alias && !Array.isArray(alias)) {
      (alias as Record<string, string>)['@engine'] = engineSource;
    } else {
      config.resolve.alias = { '@engine': engineSource };
    }
    return config;
  },
};

export default nextConfig;
