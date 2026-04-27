"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminLoginPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

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
                </CardContent>
            </Card>
        </div>
    );
}
