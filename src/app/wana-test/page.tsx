"use client";

import { useState } from "react";
import { captureException, isWanaConfigured } from "@/lib/wana";

/**
 * Wana 疎通確認ページ（dev 専用 / 本番では無効表示）。
 * ブラウザ直送・未処理エラー・バックエンド経由の3経路を、結果込みで確認できる。
 */
export default function WanaTestPage() {
    const isProd = process.env.NODE_ENV === "production";
    const [log, setLog] = useState<string[]>([]);
    const append = (line: string) =>
        setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev]);

    if (isProd) {
        return (
            <main style={wrap}>
                <h1>Wana テスト</h1>
                <p>このページは開発環境専用です（本番では無効）。</p>
            </main>
        );
    }

    const testFrontDirect = async () => {
        append("① フロント直送 … 送信中");
        const res = await captureException(
            new Error("Wana frontend self-test (direct, intentional)"),
            { level: "info", tags: { source: "selftest-frontend-direct" } }
        );
        append(
            res.ok
                ? `① フロント直送 OK  status=${res.status}  eventId=${res.eventId}`
                : `① フロント直送 NG  ${res.error ?? ""} (status=${res.status ?? "-"})`
        );
    };

    const testUnhandled = () => {
        append("② 未処理 Promise 拒否を発火（WanaInit が捕捉して送信）");
        // unhandledrejection を意図的に発生させる
        void Promise.reject(new Error("Wana frontend self-test (unhandled rejection, intentional)"));
    };

    const testConsoleError = () => {
        append("④ console.error を発火（WanaInit のフックが捕捉して送信）");
        console.error(new Error(`Wana frontend self-test (console.error, intentional) ${Date.now()}`));
    };

    const testBackend = async () => {
        append("③ バックエンド経由 … /api/wana/selftest を呼び出し");
        try {
            const res = await fetch("/api/wana/selftest");
            const data = (await res.json()) as {
                ok?: boolean;
                eventId?: string;
                status?: number;
                error?: string;
            };
            append(
                data.ok
                    ? `③ バックエンド OK  ingestStatus=${data.status}  eventId=${data.eventId}`
                    : `③ バックエンド NG  ${data.error ?? ""} (status=${data.status ?? res.status})`
            );
        } catch (e) {
            append(`③ バックエンド NG  ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    return (
        <main style={wrap}>
            <h1>Wana 疎通テスト（dev）</h1>
            <p>
                DSN 設定: <strong>{isWanaConfigured() ? "OK（読み込み済み）" : "未設定"}</strong>
            </p>
            <p style={{ color: "#666" }}>
                各ボタンでテストイベントを送信します。送信後、Wana ダッシュボードの
                <code> chousei-kun </code>プロジェクトに表示されれば成功です。eventId で突き合わせできます。
            </p>

            <div style={btnRow}>
                <button style={btn} onClick={testFrontDirect}>
                    ① フロントから直送
                </button>
                <button style={btn} onClick={testUnhandled}>
                    ② 未処理エラーを発火
                </button>
                <button style={btn} onClick={testBackend}>
                    ③ バックエンド経由
                </button>
                <button style={btn} onClick={testConsoleError}>
                    ④ console.error を発火
                </button>
            </div>

            <h2 style={{ marginTop: "1.5rem", fontSize: "1rem" }}>結果ログ</h2>
            <pre style={logBox}>{log.length ? log.join("\n") : "（まだ送信していません）"}</pre>
        </main>
    );
}

const wrap: React.CSSProperties = {
    maxWidth: 720,
    margin: "0 auto",
    padding: "2rem 1.25rem",
    fontFamily: "sans-serif",
};
const btnRow: React.CSSProperties = { display: "flex", gap: "0.75rem", flexWrap: "wrap" };
const btn: React.CSSProperties = {
    padding: "0.6rem 1rem",
    borderRadius: "0.5rem",
    border: "1px solid currentColor",
    cursor: "pointer",
    background: "transparent",
};
const logBox: React.CSSProperties = {
    background: "#11151c",
    color: "#d6e2f0",
    padding: "1rem",
    borderRadius: "0.5rem",
    whiteSpace: "pre-wrap",
    minHeight: 120,
    fontSize: "0.8rem",
    lineHeight: 1.6,
};
