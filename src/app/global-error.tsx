"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/wana";

/**
 * ルートレイアウト/テンプレートで発生したエラーの最終捕捉境界。
 * global-error は自前で <html>/<body> を描画する必要がある。
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        captureException(error, {
            tags: { source: "react-global-error" },
            extra: { digest: error.digest },
        });
    }, [error]);

    return (
        <html lang="ja">
            <body style={{ fontFamily: "sans-serif", padding: "2rem", textAlign: "center" }}>
                <h2>予期しないエラーが発生しました</h2>
                <p>問題が報告されました。ページを再読み込みしてください。解決しない場合はホームからやり直してください。</p>
                <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", justifyContent: "center" }}>
                    <button
                        onClick={reset}
                        style={{
                            padding: "0.5rem 1.25rem",
                            borderRadius: "0.5rem",
                            border: "1px solid currentColor",
                            cursor: "pointer",
                            background: "none",
                        }}
                    >
                        再試行
                    </button>
                    <a
                        href="/"
                        style={{
                            padding: "0.5rem 1.25rem",
                            borderRadius: "0.5rem",
                            border: "1px solid currentColor",
                            textDecoration: "none",
                            color: "inherit",
                        }}
                    >
                        ホームに戻る
                    </a>
                </div>
            </body>
        </html>
    );
}
