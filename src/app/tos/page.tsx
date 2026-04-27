import Link from "next/link";

export default function TermsOfServicePage() {
	return (
		<main className="min-h-screen bg-background text-foreground p-6 md:p-10">
			<div className="mx-auto max-w-3xl space-y-6">
				<h1 className="text-3xl font-bold">利用規約</h1>
				<p className="text-sm text-muted-foreground">最終更新日: 2026-04-27</p>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">1. 適用</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						本規約は、調整くん（以下「本サービス」）の利用条件を定めるものです。利用者は、本サービスを利用することで本規約に同意したものとみなされます。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">2. 禁止事項</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						法令違反、公序良俗違反、不正アクセス、他者への迷惑行為、または本サービス運営を妨げる行為を禁止します。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">3. サービス内容の変更</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						本サービスは、事前の予告なく機能追加・変更・停止を行うことがあります。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">4. 免責事項</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						本サービスは現状有姿で提供され、完全性・正確性・可用性を保証しません。本サービス利用により生じた損害について、運営者は故意または重過失がある場合を除き責任を負いません。
					</p>
				</section>

				<section className="space-y-2">
					<h2 className="text-xl font-semibold">5. 規約の改定</h2>
					<p className="text-sm leading-7 text-muted-foreground">
						運営者は必要に応じて本規約を改定できるものとし、改定後の規約は本ページに掲載した時点で効力を生じます。
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
