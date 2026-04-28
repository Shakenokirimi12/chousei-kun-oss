import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { Calendar, Users, CheckCircle, ArrowRight } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: `${siteConfig.name} - スケジュール調整アプリ`,
	description: "イベントの日程候補を作成し、参加者の出欠を集計して最適な日程を決めるためのスケジュール調整アプリです。",
};

export default function LandingPage() {
	return (
		<div className="min-h-screen bg-background text-foreground flex flex-col">
			{/* Header */}
			<header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
				<nav className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center" aria-label="メインナビゲーション">
					<Link href="/" className="text-xl font-bold" aria-label={`${siteConfig.name} ホーム`}>
						{siteConfig.name}
					</Link>
					<ul className="flex items-center gap-4 text-sm list-none m-0 p-0">
						<li>
							<Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
								プライバシーポリシー
							</Link>
						</li>
						<li>
							<Link href="/tos" className="text-muted-foreground hover:text-foreground transition-colors">
								利用規約
							</Link>
						</li>
					</ul>
				</nav>
			</header>

			{/* Main Content */}
			<main className="flex-1">
				{/* Hero Section */}
				<section className="max-w-5xl mx-auto px-4 py-16 sm:py-24" aria-labelledby="hero-title">
					<div className="text-center space-y-6">
						<h1 id="hero-title" className="text-4xl sm:text-5xl font-extrabold tracking-tight">
							{siteConfig.name}
						</h1>
						<p className="text-xl sm:text-2xl text-muted-foreground max-w-2xl mx-auto">
							イベントの日程候補を作成し、参加者の出欠を集計して最適な日程を決めるためのスケジュール調整アプリです。
						</p>
						<div className="pt-4">
							<Link href="/create">
								<Button size="lg" className="text-lg px-8 py-6 gap-2">
									予定調整を始める
									<ArrowRight className="h-5 w-5" aria-hidden="true" />
								</Button>
							</Link>
						</div>
					</div>
				</section>

				{/* Features Section */}
				<section className="max-w-5xl mx-auto px-4 py-12" aria-labelledby="features-title">
					<h2 id="features-title" className="sr-only">主な機能</h2>
					<ul className="grid sm:grid-cols-3 gap-8 list-none m-0 p-0">
						<li className="text-center space-y-3 p-6 rounded-lg border bg-card/50">
							<div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
								<Calendar className="h-6 w-6 text-primary" />
							</div>
							<h3 className="font-semibold text-lg">簡単に候補日を作成</h3>
							<p className="text-muted-foreground text-sm">
								カレンダーから候補日時を選択するだけで、すぐに調整を開始できます。
							</p>
						</li>
						<li className="text-center space-y-3 p-6 rounded-lg border bg-card/50">
							<div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
								<Users className="h-6 w-6 text-primary" />
							</div>
							<h3 className="font-semibold text-lg">参加者の出欠を集計</h3>
							<p className="text-muted-foreground text-sm">
								URLを共有するだけで、参加者が簡単に出欠を回答できます。
							</p>
						</li>
						<li className="text-center space-y-3 p-6 rounded-lg border bg-card/50">
							<div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
								<CheckCircle className="h-6 w-6 text-primary" />
							</div>
							<h3 className="font-semibold text-lg">最適な日程を決定</h3>
							<p className="text-muted-foreground text-sm">
								集計結果から最適な日程を選び、参加者に通知できます。
							</p>
						</li>
					</ul>
				</section>

				{/* About Section */}
				<section className="max-w-5xl mx-auto px-4 py-12" aria-labelledby="about-title">
					<article className="p-8 rounded-lg border bg-card/30">
						<h2 id="about-title" className="text-xl font-semibold mb-4">{siteConfig.name} について</h2>
						<div className="space-y-4 text-muted-foreground">
							<p>
								<strong className="text-foreground">{siteConfig.name}</strong> は、グループでのイベントや会議の日程調整を簡単に行うためのWebアプリケーションです。
							</p>
							<p>
								主な機能として、候補日時の作成、参加者への共有、出欠の集計、最終日程の決定と通知があります。
								Googleカレンダーと連携することで、既存の予定を考慮した回答が可能です。
							</p>
							<p>
								アカウント登録は不要で、URLを共有するだけですぐに利用を開始できます。
							</p>
						</div>
					</article>
				</section>
			</main>

			{/* Footer */}
			<footer className="border-t bg-card/30">
				<div className="max-w-5xl mx-auto px-4 py-8">
					<div className="flex flex-col sm:flex-row justify-between items-center gap-4">
						<p className="text-sm text-muted-foreground">
							© 2026 {siteConfig.name}
						</p>
						<nav aria-label="フッターナビゲーション">
							<ul className="flex items-center gap-6 text-sm list-none m-0 p-0">
								<li>
									<Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
										プライバシーポリシー
									</Link>
								</li>
								<li>
									<Link href="/tos" className="text-muted-foreground hover:text-foreground transition-colors">
										利用規約
									</Link>
								</li>
							</ul>
						</nav>
					</div>
				</div>
			</footer>
		</div>
	);
}
