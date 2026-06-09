import Link from "next/link";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { Calendar, Users, CheckCircle, ArrowRight, Sparkles, Clock } from "lucide-react";
import type { Metadata } from "next";
import { budouxify } from "@/lib/budoux";

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
				<section className="max-w-5xl mx-auto px-4 py-10 sm:py-14" aria-labelledby="hero-title">
					<div className="text-center space-y-6">
						<h1 id="hero-title" className="text-4xl sm:text-5xl font-extrabold tracking-tight">
							{siteConfig.name}
						</h1>
						<p className="text-xl sm:text-2xl text-muted-foreground max-w-2xl mx-auto" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
							{budouxify("イベントの日程候補を作成し、参加者の出欠を集計して最適な日程を決めるためのスケジュール調整アプリです。")}
						</p>
						<div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
							<Link href="/create" className="w-full sm:w-auto">
								<Button size="lg" className="text-lg px-8 py-6 gap-2 w-full sm:w-auto">
									予定調整を始める
									<ArrowRight className="h-5 w-5" aria-hidden="true" />
								</Button>
							</Link>
						</div>
					</div>
				</section>

				{/* Features Section */}
				<section className="max-w-5xl mx-auto px-4 pb-8 sm:pb-12" aria-labelledby="features-title">
					<h2 id="features-title" className="sr-only">主な機能</h2>
					<ul className="grid sm:grid-cols-3 gap-8 list-none m-0 p-0">
						<li className="text-center space-y-3 p-6 rounded-lg border bg-card/50">
							<div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
								<Calendar className="h-6 w-6 text-primary" />
							</div>
							<h3 className="font-semibold text-lg" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>{budouxify("簡単に候補日を作成")}</h3>
							<p className="text-muted-foreground text-sm" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
								{budouxify("カレンダーから候補日時を選択するだけで、すぐに調整を開始できます。")}
							</p>
						</li>
						<li className="text-center space-y-3 p-6 rounded-lg border bg-card/50">
							<div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
								<Users className="h-6 w-6 text-primary" />
							</div>
							<h3 className="font-semibold text-lg" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>{budouxify("参加者の出欠を集計")}</h3>
							<p className="text-muted-foreground text-sm" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
								{budouxify("URLを共有するだけで、参加者が簡単に出欠を回答できます。")}
							</p>
						</li>
						<li className="text-center space-y-3 p-6 rounded-lg border bg-card/50">
							<div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center" aria-hidden="true">
								<CheckCircle className="h-6 w-6 text-primary" />
							</div>
							<h3 className="font-semibold text-lg" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>{budouxify("最適な日程を決定")}</h3>
							<p className="text-muted-foreground text-sm" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
								{budouxify("集計結果から最適な日程を選び、参加者に通知できます。")}
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
							</p>
							<p>
								アカウント登録は不要で、URLを共有するだけですぐに利用を開始できます。
							</p>
						</div>
					</article>
				</section>

				{/* Google Calendar Integration Section */}
				<section className="max-w-5xl mx-auto px-4 py-12" aria-labelledby="google-integration-title">
					<article className="p-8 rounded-lg border bg-card/30">
						<h2 id="google-integration-title" className="text-xl font-semibold mb-4">Googleカレンダー連携について</h2>
						<div className="space-y-4 text-muted-foreground">
							<p>
								<strong className="text-foreground">{siteConfig.name}</strong> では、Googleカレンダーと連携することで、より便利に日程調整を行うことができます。
							</p>
							<h3 className="text-lg font-medium text-foreground mt-6">Googleカレンダーデータの使用目的</h3>
							<ul className="list-disc list-inside space-y-2 ml-4">
								<li>
									<strong>既存の予定の確認:</strong> あなたのGoogleカレンダーの予定を読み取り、候補日時と重複する予定を自動的に検出します。これにより、空いている日時を簡単に把握できます。
								</li>
								<li>
									<strong>カレンダーへの予定追加:</strong> 日程が確定した際に、参加者のGoogleカレンダーに予定を自動で追加し、招待を送信できます。
								</li>
							</ul>
							<h3 className="text-lg font-medium text-foreground mt-6">データの取り扱い</h3>
							<ul className="list-disc list-inside space-y-2 ml-4">
								<li>Googleカレンダーへのアクセスは任意です。連携しなくても基本機能は利用できます。</li>
								<li>取得したカレンダーデータはお使いのブラウザ内でのみ処理され、当サービスのサーバーには保存されません。</li>
								<li>いつでもGoogleアカウントの設定からアクセス権を取り消すことができます。</li>
							</ul>
							<p className="mt-4">
								詳しくは <Link href="/privacy" className="text-primary underline underline-offset-4 hover:text-primary/80">プライバシーポリシー</Link> をご確認ください。
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
									<Link href="/release-notes" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
										<Sparkles className="h-3 w-3" /> リリースノート
									</Link>
								</li>
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
