"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Calendar as CalendarIcon, GraduationCap, Link as LinkIcon, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface CalendarImportMenuProps {
    /** メインボタンのラベル。例: 「自分の予定から取り込む」 */
    triggerLabel: string;
    /** モーダルの見出し */
    title: string;
    /** モーダル冒頭の説明文（任意） */
    description?: string;
    /** Campus Square 連携が有効か */
    enableCampusSquare: boolean;
    /** Google カレンダー取込ハンドラ（1クリックで実行） */
    onGoogleImport: () => Promise<void> | void;
    onGoogleImportLoading?: boolean;
    /** 大学（Campus Square）取込ハンドラ */
    onCampusImport: (uid: string, pass: string) => Promise<void>;
    /** iCal URL 取込ハンドラ */
    onICalImport: (url: string) => Promise<void>;
    /** トリガーボタンのスタイル種別 */
    triggerVariant?: "default" | "outline";
}

type Source = null | "google" | "campus" | "ical";

/**
 * 複数の予定取り込み手段（Google / 大学 / iCal）を 1 つのエントリーポイントに集約するメニュー。
 * 以前は 3 つのボタンが横並びで「結局どれを使えばいいか分からない」状態だったのを、
 * 1 つのプライマリ動作に統合し、モーダル内で目的別に選ばせる形に再構築している。
 */
export default function CalendarImportMenu({
    triggerLabel,
    title,
    description,
    enableCampusSquare,
    onGoogleImport,
    onGoogleImportLoading,
    onCampusImport,
    onICalImport,
    triggerVariant = "outline",
}: CalendarImportMenuProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [source, setSource] = React.useState<Source>(null);
    const [uid, setUid] = React.useState("");
    const [pass, setPass] = React.useState("");
    const [icalUrl, setIcalUrl] = React.useState("");
    const [submitting, setSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);

    const close = () => {
        setIsOpen(false);
        // モーダルを閉じてから少し遅らせてリセット（フェードアウト中の表示崩れ防止）
        setTimeout(() => {
            setSource(null);
            setUid("");
            setPass("");
            setIcalUrl("");
            setSubmitting(false);
            setSubmitError(null);
        }, 200);
    };

    const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "取り込みに失敗しました。もう一度お試しください。");

    const runGoogle = async () => {
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onGoogleImport();
            close();
        } catch (e) {
            console.error(e);
            setSubmitError(errorMessage(e));
        } finally {
            setSubmitting(false);
        }
    };

    const runCampus = async () => {
        if (!uid || !pass) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onCampusImport(uid, pass);
            close();
        } catch (e) {
            console.error(e);
            setSubmitError(errorMessage(e));
        } finally {
            setSubmitting(false);
        }
    };

    const runICal = async () => {
        if (!icalUrl) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onICalImport(icalUrl);
            close();
        } catch (e) {
            console.error(e);
            setSubmitError(errorMessage(e));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(v) => (v ? setIsOpen(true) : close())}>
            <Button
                type="button"
                variant={triggerVariant}
                size="sm"
                className="gap-2"
                onClick={() => setIsOpen(true)}
            >
                <Sparkles className="h-4 w-4" />
                {triggerLabel}
            </Button>

            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && (
                        <DialogDescription>{description}</DialogDescription>
                    )}
                </DialogHeader>

                {source === null && (
                    <div className="space-y-2 py-2">
                        <SourceButton
                            icon={<CalendarIcon className="h-5 w-5" />}
                            label="Googleカレンダー"
                            sub="1クリックで連携・取り込み"
                            onClick={runGoogle}
                            loading={!!onGoogleImportLoading || submitting}
                        />
                        {enableCampusSquare && (
                            <SourceButton
                                icon={<GraduationCap className="h-5 w-5" />}
                                label="大学の時間割"
                                sub="学籍番号とパスワードで取得"
                                onClick={() => setSource("campus")}
                            />
                        )}
                        <SourceButton
                            icon={<LinkIcon className="h-5 w-5" />}
                            label="iCal形式のURL"
                            sub="iCalendar(.ics) を直接指定"
                            onClick={() => setSource("ical")}
                        />
                    </div>
                )}

                {source === "campus" && (
                    <div className="space-y-3 py-2">
                        <div className="space-y-1.5">
                            <label htmlFor="cs-uid" className="text-sm font-medium">学籍番号</label>
                            <Input id="cs-uid" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="username" />
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor="cs-pass" className="text-sm font-medium">パスワード</label>
                            <Input id="cs-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            送信はこのデバイスから大学のシステムへの取得にのみ使われ、保存されません。
                        </p>
                    </div>
                )}

                {source === "ical" && (
                    <div className="space-y-3 py-2">
                        <div className="space-y-1.5">
                            <label htmlFor="ical-url" className="text-sm font-medium">iCal URL</label>
                            <Input
                                id="ical-url"
                                value={icalUrl}
                                onChange={(e) => setIcalUrl(e.target.value)}
                                placeholder="https://example.com/calendar.ics"
                                inputMode="url"
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Googleカレンダーの「非公開URL」など、.ics を返すURLを貼り付けてください。
                        </p>
                    </div>
                )}

                {submitError && (
                    <p className="text-sm text-destructive">{submitError}</p>
                )}

                <DialogFooter className="gap-2 sm:gap-2">
                    {source !== null && (
                        <Button variant="ghost" size="sm" onClick={() => { setSource(null); setSubmitError(null); }} disabled={submitting}>
                            戻る
                        </Button>
                    )}
                    {source === "campus" && (
                        <Button size="sm" onClick={runCampus} disabled={submitting || !uid || !pass}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            取り込む
                        </Button>
                    )}
                    {source === "ical" && (
                        <Button size="sm" onClick={runICal} disabled={submitting || !icalUrl}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            取り込む
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SourceButton({
    icon,
    label,
    sub,
    onClick,
    loading,
}: {
    icon: React.ReactNode;
    label: string;
    sub: string;
    onClick: () => void;
    loading?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={loading}
            className={cn(
                "w-full flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:opacity-60 disabled:cursor-not-allowed"
            )}
        >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
            </div>
            <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground truncate">{sub}</div>
            </div>
        </button>
    );
}
