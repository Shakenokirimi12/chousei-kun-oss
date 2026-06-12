"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Loader2, Lock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OfficeHourCreateForm, type EditData } from "@/components/officeHour/OfficeHourCreateForm";

export default function OfficeHourEditPage() {
    const params = useParams<{ id: string }>();
    const id = params.id;

    const [authorized, setAuthorized] = React.useState<boolean | null>(null);
    const [editData, setEditData] = React.useState<EditData | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const [password, setPassword] = React.useState("");
    const [authError, setAuthError] = React.useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    const loadSettings = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/office-hours/${id}/admin/settings`);
            if (res.status === 401) {
                setAuthorized(false);
                return;
            }
            if (res.status === 404) {
                setError("この Office Hour は存在しません");
                return;
            }
            if (!res.ok) {
                setError("設定の取得に失敗しました");
                return;
            }
            const data = (await res.json()) as {
                title: string;
                description: string | null;
                startDate: number | null;
                endDate: number | null;
                windows: { day: number; start: string; end: string }[];
                slotDurationMin: number;
                capacityPerSlot: number;
                bufferMin: number;
            };
            setEditData({ id, ...data });
            setAuthorized(true);
        } catch {
            setError("通信エラーが発生しました");
        }
    }, [id]);

    React.useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const submitAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError(null);
        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/office-hours/${id}/admin-auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                setAuthError("パスワードが正しくありません");
                return;
            }
            await loadSettings();
        } catch {
            setAuthError("通信エラーが発生しました");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (error) {
        return (
            <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
                <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-muted-foreground">{error}</p>
            </div>
        );
    }

    if (authorized === null) {
        return (
            <div className="flex items-center justify-center min-h-[50vh] gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> 読み込み中...
            </div>
        );
    }

    if (authorized === false) {
        return (
            <div className="min-h-screen bg-background text-foreground pb-24">
                <form onSubmit={submitAuth} className="max-w-md mx-auto py-12 px-4 space-y-4">
                    <div className="space-y-1.5">
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Lock className="h-5 w-5" /> 設定を編集
                        </h1>
                        <p className="text-sm text-muted-foreground">管理者パスワードを入力してください。</p>
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor="oh-edit-pw" className="text-sm font-medium">パスワード</label>
                        <Input id="oh-edit-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    </div>
                    {authError && (
                        <div role="alert" className="text-sm text-destructive flex items-start gap-2">
                            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {authError}
                        </div>
                    )}
                    <Button type="submit" disabled={isSubmitting || !password} className="w-full sm:w-auto">
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        ログイン
                    </Button>
                </form>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <OfficeHourCreateForm editData={editData!} />
        </div>
    );
}
