/**
 * Universal Links 用の Apple App Site Association (AASA)。
 *
 * これを配信すると、この調整くんインスタンスのイベント URL を iOS 端末で開いた
 * ときに、インストール済みの公式アプリが直接起動する（Safari を経由しない）。
 *
 * `IOS_APP_ID` が未設定なら 404 を返す。OSS テンプレートとして特定の
 * Apple Developer Team / Bundle ID をハードコードしないための既定動作で、
 * アプリを配布していない自ホスト環境では何も配信されない。
 *
 * 参考: https://developer.apple.com/documentation/xcode/supporting-associated-domains
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

/** `TEAMID.bundle.id` 形式。複数アプリを載せる場合はカンマ区切り。 */
const APP_ID_RE = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;

/**
 * UUID v4 のイベント ID にだけマッチさせるためのパスパターン。
 * AASA の `?` は 1 文字ワイルドカード。`/*` にすると /create や /tos まで
 * アプリに奪われてしまうので、意図的に UUID の形だけを対象にしている。
 */
const EVENT_ID_GLOB = "/????????-????-????-????-????????????";

export async function GET() {
	let appIDs: string[] = [];
	try {
		const { env } = await getCloudflareContext();
		const raw = (env as unknown as { IOS_APP_ID?: string }).IOS_APP_ID ?? process.env.IOS_APP_ID;
		appIDs = (raw ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter((s) => APP_ID_RE.test(s));
	} catch {
		appIDs = [];
	}

	if (appIDs.length === 0) {
		return new Response("Not Found", { status: 404 });
	}

	const body = {
		applinks: {
			details: [
				{
					appIDs,
					components: [
						{ "/": EVENT_ID_GLOB, comment: "回答画面" },
						{ "/": `${EVENT_ID_GLOB}/results`, comment: "回答結果" },
						{ "/": `${EVENT_ID_GLOB}/admin`, comment: "管理画面" },
					],
				},
			],
		},
	};

	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {
			// AASA は必ず application/json で配信する必要がある（リダイレクト不可）
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
