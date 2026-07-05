import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
// dev 専用。本番ビルド(`next build`)では呼ばない: Flagship 等のリモート
// バインディングに対してリモートプレビューセッションを張ろうとしてビルドが
// 失敗するため（getCloudflareContext は実行時にのみ使う）。
if (process.env.NODE_ENV !== "production") {
	initOpenNextCloudflareForDev();
}

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	turbopack: {
		root: projectRoot,
	},
	
	// Cloudflare Workers compatibility
	experimental: {
		serverActions: {
			bodySizeLimit: "1mb",
		},
	},
	
	// Optimize for Cloudflare
	poweredByHeader: false,
	
	// Strict mode for better error detection
	reactStrictMode: true,
	
	// Headers for security and caching
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						key: "X-Frame-Options",
						value: "DENY",
					},
					{
						key: "X-XSS-Protection",
						value: "1; mode=block",
					},
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
				],
			},
			{
				source: "/api/:path*",
				headers: [
					{
						key: "Cache-Control",
						value: "no-store, max-age=0",
					},
				],
			},
		];
	},
};

export default nextConfig;
