"use client";

import * as React from "react";

type State = "idle" | "copied" | "error";

/**
 * クリップボードコピーの状態管理フック。
 *
 * - 成功: state="copied" になり 2 秒で idle に戻る
 * - 失敗: state="error" になり 2 秒で idle に戻る
 *   （HTTP 経由 / 古いブラウザ / 権限不足など）
 *
 * いずれもボタン側でアイコン・色を切り替える前提で、本フックは表示を伴わない。
 */
export function useCopy(timeoutMs = 2000) {
    const [state, setState] = React.useState<State>("idle");
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const copy = React.useCallback(async (text: string) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        try {
            if (typeof navigator === "undefined" || !navigator.clipboard) {
                throw new Error("clipboard unavailable");
            }
            await navigator.clipboard.writeText(text);
            setState("copied");
        } catch (e) {
            console.error("[useCopy] failed", e);
            setState("error");
        }
        timerRef.current = setTimeout(() => setState("idle"), timeoutMs);
    }, [timeoutMs]);

    return {
        state,
        copied: state === "copied",
        error: state === "error",
        copy,
    };
}
