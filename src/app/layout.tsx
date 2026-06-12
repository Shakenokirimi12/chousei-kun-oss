import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Geist_Mono } from "next/font/google";
import { siteConfig } from "@/config/site";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { FeedbackButton } from "@/components/FeedbackButton";

// デジタル庁デザインシステム(DADS)準拠: 本文書体は Noto Sans JP
const notoSansJP = Noto_Sans_JP({
	variable: "--font-noto-sans-jp",
	subsets: ["latin"],
	weight: ["400", "500", "700"],
	display: "swap",
	preload: false, // CJK フォントは preload 非対応
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: siteConfig.name,
	description: siteConfig.description,
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="ja" suppressHydrationWarning>
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
			</head>
			<body className={`${notoSansJP.variable} ${geistMono.variable} antialiased`}>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					{children}
					<FeedbackButton />
				</ThemeProvider>
			</body>
		</html>
	);
}
