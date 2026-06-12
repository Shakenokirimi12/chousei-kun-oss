"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Clock, Loader2, Plus, ExternalLink, Settings } from "lucide-react";
import { formatDateLabel } from "@/lib/officeHour";
import { useUser } from "@/hooks/useUser";

type OfficeHourItem = {
    id: string;
    title: string;
    description: string | null;
    startDate: number | null;
    endDate: number | null;
    slotDurationMin: number;
    capacityPerSlot: number;
    lastSyncAt: number | null;
    createdAt: number;
};

type ListResponse = {
    items: OfficeHourItem[];
    authenticated: boolean;
    email?: string;
    noUserId?: boolean;
};

export function OfficeHourListView() {
    const { userId } = useUser();
    const [data, setData] = React.useState<ListResponse | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/office-hours/mine");
                if (res.ok) {
                    setData(await res.json() as ListResponse);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> 読み込み中...
            </div>
        );
    }

    if (!data?.authenticated) {
        return (
            <div className="max-w-xl mx-auto py-12 px-4 space-y-6">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Office Hour</h1>
                <p className="text-muted-foreground">
                    Office Hour の管理にはGoogleアカウントの連携が必要です。
                </p>
                <Button asChild size="lg" className="gap-2">
                    <a href={`/api/google/auth/start?returnTo=${encodeURIComponent("/office-hours")}${userId ? `&userId=${userId}` : ""}`}>
                        <CalendarIcon className="h-4 w-4" /> Googleアカウントを連携する
                    </a>
                </Button>
            </div>
        );
    }

    if (data.noUserId) {
        return (
            <div className="max-w-xl mx-auto py-12 px-4 space-y-6">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Office Hour</h1>
                <p className="text-muted-foreground">
                    ユーザー情報の紐付けが必要です。お手数ですが、一度ログアウトしてから再連携してください。
                </p>
                <div className="flex gap-3">
                    <Button variant="outline" onClick={async () => {
                        await fetch("/api/google/logout", { method: "POST" });
                        window.location.reload();
                    }}>
                        ログアウト
                    </Button>
                    <Button asChild className="gap-2">
                        <a href={`/api/google/auth/start?returnTo=${encodeURIComponent("/office-hours")}${userId ? `&userId=${userId}` : ""}`}>
                            <CalendarIcon className="h-4 w-4" /> 再連携する
                        </a>
                    </Button>
                </div>
            </div>
        );
    }

    const items = data.items;
    const now = Date.now();
    const active = items.filter((i) => i.endDate === null || i.endDate >= now);
    const ended = items.filter((i) => i.endDate !== null && i.endDate < now);

    return (
        <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Office Hour</h1>
                    <p className="text-sm text-muted-foreground mt-1">{data.email} でログイン中</p>
                </div>
                <Button asChild className="gap-2">
                    <Link href="/office-hours/create">
                        <Plus className="h-4 w-4" /> 新規作成
                    </Link>
                </Button>
            </div>

            {items.length === 0 ? (
                <div className="text-center py-16 space-y-4">
                    <Clock className="h-12 w-12 mx-auto text-muted-foreground/40" />
                    <p className="text-muted-foreground">まだ Office Hour がありません</p>
                    <Button asChild variant="outline" className="gap-2">
                        <Link href="/office-hours/create">
                            <Plus className="h-4 w-4" /> 最初の Office Hour を作成
                        </Link>
                    </Button>
                </div>
            ) : (
                <>
                    {active.length > 0 && (
                        <Section title={`受付中（${active.length}件）`}>
                            {active.map((item) => (
                                <OfficeHourCard key={item.id} item={item} />
                            ))}
                        </Section>
                    )}
                    {ended.length > 0 && (
                        <Section title={`終了済み（${ended.length}件）`}>
                            {ended.map((item) => (
                                <OfficeHourCard key={item.id} item={item} ended />
                            ))}
                        </Section>
                    )}
                </>
            )}
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
            <div className="space-y-3">{children}</div>
        </section>
    );
}

function OfficeHourCard({ item, ended }: { item: OfficeHourItem; ended?: boolean }) {
    const period = item.startDate != null && item.endDate != null
        ? `${formatDateLabel(item.startDate)} 〜 ${formatDateLabel(item.endDate)}`
        : item.startDate != null
            ? `${formatDateLabel(item.startDate)} 〜`
            : "常時受付";

    return (
        <div className={`rounded-lg border bg-card/40 p-4 transition-colors hover:bg-card/60 ${ended ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold truncate">{item.title}</h3>
                    {item.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                        <span>{period}</span>
                        <span>{item.slotDurationMin}分枠 / 定員{item.capacityPerSlot}名</span>
                        {item.lastSyncAt && (
                            <span>最終同期: {formatDateLabel(item.lastSyncAt)}</span>
                        )}
                    </div>
                </div>
                <div className="flex gap-2 shrink-0">
                    <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <Link href={`/office-hours/${item.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" /> 予約ページ
                        </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm" className="gap-1.5">
                        <Link href={`/office-hours/${item.id}/admin`}>
                            <Settings className="h-3.5 w-3.5" /> 管理
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
