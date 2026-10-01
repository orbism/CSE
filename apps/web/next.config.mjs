/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // MODE=DEMO|LIVE, set plainly in Vercel. Only NEXT_PUBLIC_* reaches the
  // browser on its own, so it is copied into the build here.
  env: { MODE: (process.env.MODE ?? "LIVE").toUpperCase() },
  // both workspace packages ship TypeScript source rather than a build step
  transpilePackages: ["@cse/core", "@cse/art"],
  webpack: (config) => {
    // The workspace packages use ESM-correct ".js" specifiers that actually
    // resolve to ".ts" sources; webpack needs to be told to follow them.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };

    // `ox` — a viem dependency, reached via wagmi's chain list — builds a
    // require path from an expression, which webpack cannot follow statically.
    // Nothing here imports that module's dynamic branch, so the warning is
    // noise, and it drowned out warnings that would matter. Matched narrowly on
    // the module path rather than the message so an equivalent warning from our
    // own code still surfaces.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /node_modules\/.pnpm\/ox@[^/]+\/node_modules\/ox\//,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];
    return config;
  },
};

export default nextConfig;
