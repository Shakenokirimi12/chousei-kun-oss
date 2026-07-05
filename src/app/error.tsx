"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/wana";

/**
 * セグメント単位の React レンダリングエラー境界。Wana に送信したうえで
 * 簡易なリトライ UI を表示する。
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        captureException(error, {
            tags: { source: "react-error-boundary" },
            extra: { digest: error.digest },
        });
    }, [error]);

    return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
            <h2>エラーが発生しました</h2>
            <p>問題が報告されました。もう一度お試しください。解決しない場合はホームからやり直してください。</p>
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
        </div>
    );
}
