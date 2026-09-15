import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "アプリに引き継ぐ",
	robots: { index: false },
};

/**
 * /me の「アプリに引き継ぐ」の着地点。
 *
 * /me はまずカスタムスキーム（chouseikun://import）でアプリを起動し、反応が
 * 無ければここへ送る。つまりここに来るのはアプリが無い場合。利用者 ID は URL の
 * fragment に載っているので、このページ（サーバー）には届かない。
 * アプリ側はこの URL 形式も「リンクから開く」で受け付ける。
 */
export default function AppImportPage() {
	return (
		<main className="min-h-screen bg-background text-foreground p-6 md:p-10">
			<div className="mx-auto max-w-xl space-y-4">
				<h1 className="text-2xl font-bold">アプリに引き継ぐ</h1>
				<p className="text-sm leading-7 text-muted-foreground">
					調整くん iOS アプリがインストールされていれば、このリンクを開いた時点でアプリが起動し、
					ブラウザで作成した予定表の一覧がアプリに引き継がれます。
				</p>
				<p className="text-sm leading-7 text-muted-foreground">
					このページが表示されている場合は、アプリがインストールされていません。
					アプリをインストールしたうえで、「作成したイベント」ページの「アプリに引き継ぐ」をもう一度お試しください。
					すでにインストール済みなら、このページの URL をコピーしてアプリのホームにある「リンクから開く」に貼り付けても引き継げます。
				</p>
				<Link href="/me" className="text-sm underline">
					作成したイベントに戻る
				</Link>
			</div>
		</main>
	);
}
