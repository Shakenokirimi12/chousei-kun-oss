"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CircleAlert } from "lucide-react";

// FeedbackButton と同じ条件。未設定ならヘルプボタン自体が出ないので、そこへ案内しない
const HAS_FEEDBACK_CONTACT = !!process.env.NEXT_PUBLIC_FEEDBACK_EMAIL;

export function AdminLoginForm({ eventTitle }: { eventTitle: string }) {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [failCount, setFailCount] = useState(0);

    const id = params.id;

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await fetch(`/api/events/${id}/admin-auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                setError("パスワードが正しくありません。");
                setFailCount((c) => c + 1);
                return;
            }
            router.replace(`/${id}/admin`);
            router.refresh();
        } catch {
            setError("認証中にエラーが発生しました。");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle>管理画面ログイン</CardTitle>
                    <p className="text-sm font-medium break-words">{eventTitle}</p>
                    <CardDescription>イベント作成時に設定したパスワードを入力してください。</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <label htmlFor="admin-password" className="text-sm font-medium">
                            管理者パスワード
                        </label>
                        <Input
                            id="admin-password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="管理者パスワード"
                            required
                        />
                        {error ? <p className="text-sm text-destructive">{error}</p> : null}
                        <Button type="submit" className="w-full" disabled={loading || !password}>
                            {loading ? "確認中..." : "ログイン"}
                        </Button>
                    </form>

                    {failCount >= 2 && (
                        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                            <p className="flex items-center gap-1.5 font-medium">
                                <CircleAlert className="h-4 w-4 shrink-0" />
                                パスワードを思い出せませんか？
                            </p>
                            <p>
                                このアプリは管理者パスワードの再発行に対応していません（メールアドレス等を保存していないため）。
                            </p>
                            <p>
                                パスワードが無くても、参加者は回答を続けられます。結果を公開しているイベントなら、「結果確認 URL」から結果も見られます。日程の確定など、管理の操作だけができなくなります。
                            </p>
                            {HAS_FEEDBACK_CONTACT ? (
                                <p>
                                    心当たりのパスワードを試し尽くした場合は、ページ下部の「ヘルプ・フィードバック」からお問い合わせください。
                                </p>
                            ) : null}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
