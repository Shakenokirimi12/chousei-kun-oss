"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CircleAlert } from "lucide-react";

export default function AdminLoginPage() {
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
                    <CardDescription>イベント作成時に設定したパスワードを入力してください。</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <Input
                            type="password"
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
                                回答結果は管理者パスワードなしでも「結果確認 URL」から引き続き閲覧でき、参加者は回答を続けられます。日程の確定など管理操作だけができない状態になります。
                            </p>
                            <p>
                                心当たりのパスワードを試し尽くした場合は、画面右下のヘルプボタンからお問い合わせください。
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
