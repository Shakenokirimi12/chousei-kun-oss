import Link from "next/link";

export default function PrivacyPolicyPage() {
	return (
		<main className="min-h-screen bg-background text-foreground p-6 md:p-10">
			<div className="mx-auto max-w-3xl space-y-6">
				<h1 className="text-3xl font-bold">プライバシーポリシー</h1>
				<p className="text-sm text-muted-foreground">最終更新日: 2026-04-27</p>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">1. 取得する情報</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						本サービスでは、イベント作成・回答のために入力された氏名、コメント、出欠情報、通知用メールアドレス等を取得します。Google連携時には、連携に必要な範囲でGoogleアカウント情報（メールアドレス、カレンダー予定情報）を取得します。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">2. 利用目的</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						取得した情報は、日程調整機能の提供、重複予定の判定、通知送信、サービスの保守・改善のために利用します。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">3. 第三者提供</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">4. 外部サービス連携</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						Google Calendar API を利用する際は、Googleの利用規約およびプライバシーポリシーが適用される場合があります。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">5. 安全管理</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						運営者は、不正アクセス、漏えい、滅失、毀損の防止に努め、合理的な安全管理措置を講じます。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">6. お問い合わせ</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						本ポリシーに関するお問い合わせは、運営者が指定する窓口までご連絡ください。
					</p>
				</section>

				<div className="pt-4">
					<Link href="/" className="text-sm underline underline-offset-4">
						トップへ戻る
					</Link>
				</div>
			</div>
		</main>
	);
}
