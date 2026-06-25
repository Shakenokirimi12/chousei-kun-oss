"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle } from "lucide-react";
import { ShiftCreateForm, type ShiftEditData } from "./ShiftCreateForm";
import type { ShiftAdminView } from "@/lib/shift";

type Phase = "loading" | "auth" | "ready" | "error";

export function ShiftEditView({ boardId }: { boardId: string }) {
    const [phase, setPhase] = React.useState<Phase>("loading");
    const [editData, setEditData] = React.useState<ShiftEditData | null>(null);
    const [password, setPassword] = React.useState("");
    const [authError, setAuthError] = React.useState<string | null>(null);
    const [authing, setAuthing] = React.useState(false);

    const load = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/shifts/${boardId}/admin`);
            if (res.status === 401) {
                setPhase("auth");
                return;
            }
            if (!res.ok) {
                setPhase("error");
                return;
            }
            const view = (await res.json()) as ShiftAdminView;
            setEditData({
                id: view.board.id,
                title: view.board.title,
                description: view.board.description,
                date: view.board.date,
                submissionDeadline: view.board.submissionDeadline,
                slots: view.slots,
            });
            setPhase("ready");
        } catch {
            setPhase("error");
        }
    }, [boardId]);

    React.useEffect(() => {
        load();
    }, [load]);

    const handleAuth = async () => {
        setAuthError(null);
        setAuthing(true);
        try {
            const res = await fetch(`/api/shifts/${boardId}/admin-auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                const d = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(d.error === "Invalid password" ? "パスワードが違います。" : d.error ?? "失敗しました。");
            }
            setPassword("");
            setPhase("loading");
            await load();
        } catch (e) {
            setAuthError(e instanceof Error ? e.message : "エラーが発生しました。");
        } finally {
            setAuthing(false);
        }
    };

    if (phase === "loading") {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (phase === "auth") {
        return (
            <div className="mx-auto max-w-sm space-y-4 px-4 py-16">
                <h1 className="text-xl font-bold">管理者ログイン</h1>
                <Input
                    type="password"
                    placeholder="管理パスワード"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                />
                {authError && (
                    <p className="flex items-center gap-1.5 text-sm text-destructive">
                        <AlertCircle className="size-4" />
                        {authError}
                    </p>
                )}
                <Button onClick={handleAuth} disabled={authing} className="w-full gap-2">
                    {authing && <Loader2 className="size-4 animate-spin" />}
                    ログイン
                </Button>
            </div>
        );
    }

    if (phase === "error" || !editData) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-16 text-center">
                <AlertCircle className="mx-auto size-10 text-muted-foreground" />
                <p className="mt-3 text-muted-foreground">読み込みに失敗しました。</p>
            </div>
        );
    }

    return <ShiftCreateForm editData={editData} />;
}
