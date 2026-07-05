"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/wana";

/**
 * ブラウザのグローバルエラーを Wana に送るための初期化。
 * - `window.onerror`（同期例外）
 * - `unhandledrejection`（未処理の Promise 拒否）
 * - `console.error` / `console.warn`（try/catch で握りつぶされてコンソールに出る
 *   だけのエラー。このアプリの UI 層は API 失敗等を catch → console.error +
 *   ダイアログ表示で処理するパターンが大半で、フックしないと Wana に一切届かない）
 *
 * 登録は useEffect ではなくモジュール評価時に行う。effect はハイドレーション完了後に
 * しか走らないため、初期ロード〜ハイドレーション中のエラーを取りこぼすのを防ぐ。
 * React のレンダリングエラーは error.tsx / global-error.tsx で捕捉する。
 */

let installed = false;

// Wana は自前運用でクォータを気にする必要がないため、送信は絞らず多めに流す。
// 唯一のガードとして、レンダリングループ等で同一メッセージが無限に発火した場合に
// ブラウザが fetch で埋まるのを防ぐ、メッセージ単位の回数上限だけ設ける。
const SAME_MESSAGE_LIMIT = 100;
const consoleMessageCounts = new Map<string, number>();
let inConsoleCapture = false;

function safeStringify(value: unknown): string {
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function installGlobalHandlers() {
    if (installed || typeof window === "undefined") return;
    installed = true;

    window.addEventListener("error", (event: ErrorEvent) => {
        captureException(event.error ?? new Error(event.message || "window.onerror"), {
            tags: { source: "window.onerror" },
            extra: {
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            },
        });
    });

    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const error =
            reason instanceof Error
                ? reason
                : new Error(typeof reason === "string" ? reason : "Unhandled promise rejection");
        captureException(error, { tags: { source: "unhandledrejection" } });
    });

    const captureConsoleArgs = (args: unknown[], source: string, level?: "warning") => {
        if (inConsoleCapture) return;
        try {
            inConsoleCapture = true;
            const firstError = args.find((a): a is Error => a instanceof Error);
            const message = args
                .map((a) => (a instanceof Error ? a.message : safeStringify(a)))
                .join(" ")
                .slice(0, 500);
            if (!message.trim()) return;
            const count = (consoleMessageCounts.get(message) ?? 0) + 1;
            consoleMessageCounts.set(message, count);
            if (count > SAME_MESSAGE_LIMIT) return;
            captureException(firstError ?? new Error(message), {
                ...(level ? { level } : {}),
                tags: { source },
                extra: { consoleMessage: message, occurrence: count },
            });
        } finally {
            inConsoleCapture = false;
        }
    };

    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
        originalConsoleError(...args);
        captureConsoleArgs(args, "console.error");
    };

    const originalConsoleWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
        originalConsoleWarn(...args);
        captureConsoleArgs(args, "console.warn", "warning");
    };
}

// クライアントのチャンク評価時（ハイドレーション前）に登録する。
// SSR 中のモジュール評価では typeof window ガードにより no-op。
installGlobalHandlers();

export function WanaInit() {
    // 念のための冪等な再インストール（モジュール評価が済んでいれば no-op）
    useEffect(() => {
        installGlobalHandlers();
    }, []);

    return null;
}
