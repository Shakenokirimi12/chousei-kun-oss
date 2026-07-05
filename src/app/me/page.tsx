"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

interface EventSummary {
    id: string;
    title: string;
    description: string | null;
    createdAt: number;
    confirmedCandidateIdx: number | null;
}

const USER_ID_KEY = "chosei_user_id";

export default function MyEventsPage() {
    const [items, setItems] = useState<EventSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasUserId, setHasUserId] = useState<boolean | null>(null);

    useEffect(() => {
        const uid = localStorage.getItem(USER_ID_KEY);
        if (!uid) {
            setHasUserId(false);
            return;
        }
        setHasUserId(true);
        (async () => {
            try {
                const res = await fetch(`/api/events/by-creator/${uid}`);
                if (!res.ok) throw new Error(await res.text());
                const data = (await res.json()) as { items: EventSummary[] };
                setItems(data.items);
            } catch (e) {
                setError(e instanceof Error ? e.message : "イベントの取得に失敗しました");
            }
        })();
    }, []);

    return (
        <div className="min-h-dvh p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
            <header className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">作成したイベント</h1>
                </div>
                <Link href="/create">
                    <Button>新規作成</Button>
                </Link>
            </header>

            <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                この一覧は「この端末のこのブラウザ」に保存された情報だけを頼りに表示しています。アカウント登録はしていないため、別の端末・別のブラウザや、ブラウザのデータ（Cookie・サイトデータ）を消すと一覧から消えます（イベント自体は削除されません）。
                「管理」を開く際は、この一覧に載っていても引き続き管理者パスワードの入力が必要です。
            </div>

            {hasUserId === false && (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                    まだこの端末でイベントは作成されていません。
                    <div className="mt-3">
                        <Link href="/create">
                            <Button>新しい予定表を作成</Button>
                        </Link>
                    </div>
                </div>
            )}

            {hasUserId && items === null && !error && (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> 読み込み中...
                </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {items && items.length === 0 && (
                <p className="text-sm text-muted-foreground py-12 text-center">
                    まだ作成されたイベントはありません。
                </p>
            )}

            {items && items.length > 0 && (
                <ul className="space-y-2">
                    {items.map((e) => (
                        <li key={e.id} className="rounded-md border p-3 hover:bg-accent/40 transition-colors">
                            <div className="flex justify-between items-start gap-4">
                                <div className="min-w-0">
                                    <Link href={`/${e.id}/admin`} className="font-medium hover:underline truncate block">
                                        {e.title}
                                    </Link>
                                    {e.description && (
                                        <p className="text-xs text-muted-foreground truncate mt-0.5">{e.description}</p>
                                    )}
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        作成: {format(new Date(e.createdAt), "yyyy/MM/dd HH:mm", { locale: ja })}
                                        {e.confirmedCandidateIdx !== null && " ・ 確定済み"}
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                                    <Link href={`/${e.id}/results`}>
                                        <Button size="sm" variant="outline">回答状況</Button>
                                    </Link>
                                    <Link href={`/${e.id}/admin`}>
                                        <Button size="sm" variant="ghost">管理</Button>
                                    </Link>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
