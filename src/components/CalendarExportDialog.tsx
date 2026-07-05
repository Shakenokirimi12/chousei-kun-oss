"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Calendar, Download, Loader2, X } from "lucide-react";
import { generateICalEvent, parseCandidateToDateTime, downloadICalFile } from "@/lib/ical";
import { formatAllDayCandidateLabelLong } from "@/lib/candidates";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    eventTitle: string;
    eventDescription?: string;
    confirmedCandidate: string;
    hasGoogleSession: boolean;
    onAddToGoogleCalendar: () => Promise<void>;
};

export function CalendarExportDialog({
    open,
    onOpenChange,
    eventTitle,
    eventDescription,
    confirmedCandidate,
    hasGoogleSession,
    onAddToGoogleCalendar,
}: Props) {
    const [isAddingToGoogle, setIsAddingToGoogle] = useState(false);

    const dateTime = parseCandidateToDateTime(confirmedCandidate);
    const formattedDateTime = dateTime
        ? dateTime.allDay
            ? formatAllDayCandidateLabelLong(confirmedCandidate)
            : `${format(dateTime.start, "M月d日(E) HH:mm", { locale: ja })} 〜 ${format(dateTime.end, "HH:mm", { locale: ja })}`
        : "";

    const handleDownloadIcal = () => {
        if (!dateTime) return;

        const icalContent = generateICalEvent({
            title: `${eventTitle}（確定）`,
            description: eventDescription || "調整くんで確定した日程です。",
            ...(dateTime.allDay
                ? { allDay: true as const, date: dateTime.date }
                : { startDateTime: dateTime.start, endDateTime: dateTime.end }),
        });

        const safeTitle = eventTitle.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g, "_");
        downloadICalFile(icalContent, `${safeTitle}.ics`);
        onOpenChange(false);
    };

    const handleAddToGoogle = async () => {
        setIsAddingToGoogle(true);
        try {
            await onAddToGoogleCalendar();
            onOpenChange(false);
        } finally {
            setIsAddingToGoogle(false);
        }
    };

    const handleSkip = () => {
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>日程が確定しました</DialogTitle>
                    <DialogDescription>
                        あなたのカレンダーに予定を追加しますか？
                        <br />
                        <span className="text-xs">※参加者は結果ページから各自でカレンダーに追加できます</span>
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                    <p className="font-semibold">{eventTitle}</p>
                    <p className="text-sm text-muted-foreground">{formattedDateTime}</p>
                </div>

                <div className="space-y-3">
                    {hasGoogleSession && (
                        <Button
                            variant="outline"
                            className="w-full justify-start gap-3 h-auto py-3"
                            onClick={handleAddToGoogle}
                            disabled={isAddingToGoogle}
                        >
                            {isAddingToGoogle ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <svg className="h-5 w-5" viewBox="0 0 24 24">
                                    <path
                                        fill="#4285F4"
                                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                    />
                                    <path
                                        fill="#34A853"
                                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    />
                                    <path
                                        fill="#FBBC05"
                                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    />
                                    <path
                                        fill="#EA4335"
                                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    />
                                </svg>
                            )}
                            <div className="text-left">
                                <p className="font-medium">Googleカレンダーに追加して招待を送信</p>
                                <p className="text-xs text-muted-foreground">通知希望の参加者に招待メールを送ります</p>
                            </div>
                        </Button>
                    )}

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-3 h-auto py-3"
                        onClick={handleDownloadIcal}
                    >
                        <Download className="h-5 w-5 text-blue-500" />
                        <div className="text-left">
                            <p className="font-medium">iCalファイルをダウンロード</p>
                            <p className="text-xs text-muted-foreground">
                                iPhone、Outlook、その他のカレンダーアプリで使用
                            </p>
                        </div>
                    </Button>

                    <Button
                        variant="ghost"
                        className="w-full justify-start gap-3 h-auto py-3 text-muted-foreground"
                        onClick={handleSkip}
                    >
                        <X className="h-5 w-5" />
                        <div className="text-left">
                            <p className="font-medium">スキップ</p>
                            <p className="text-xs">カレンダーに追加しない</p>
                        </div>
                    </Button>
                </div>

                {!hasGoogleSession && (
                    <p className="text-xs text-muted-foreground text-center">
                        Googleカレンダー連携をするには
                        <button
                            type="button"
                            className="underline underline-offset-2 ml-1"
                            onClick={() => {
                                const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
                                // カレンダーへの予定作成・招待送信に使うため write スコープが必要
                                window.location.href = `/api/google/auth/start?returnTo=${returnTo}&scope=write`;
                            }}
                        >
                            Googleアカウントでログイン
                        </button>
                        してください
                    </p>
                )}
            </DialogContent>
        </Dialog>
    );
}
