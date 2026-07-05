"use client";

import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, Loader2, ExternalLink, Copy, Check } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { parseCandidateToDateTime } from "@/lib/ical";
import { formatAllDayCandidateLabelLong, nextDateString } from "@/lib/candidates";
import { budouxify } from "@/lib/budoux";

type Props = {
    eventId: string;
    eventTitle: string;
    eventDescription?: string | null;
    confirmedCandidate: string;
};

export const ConfirmedScheduleCard = memo(function ConfirmedScheduleCard({
    eventId,
    eventTitle,
    eventDescription,
    confirmedCandidate,
}: Props) {
    const [isAddingToGoogle, setIsAddingToGoogle] = useState(false);
    const [addedToGoogle, setAddedToGoogle] = useState(false);
    const [copied, setCopied] = useState(false);

    const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";
    
    const icalUrl = typeof window !== "undefined" 
        ? `${window.location.origin}/api/events/${eventId}/calendar.ics`
        : "";
    const webcalUrl = isLocalhost ? icalUrl : icalUrl.replace(/^https?:/, "webcal:");

    const dateTime = parseCandidateToDateTime(confirmedCandidate);
    const formattedDateTime = dateTime
        ? dateTime.allDay
            ? formatAllDayCandidateLabelLong(confirmedCandidate)
            : `${format(dateTime.start, "yyyy年M月d日(E) HH:mm", { locale: ja })} 〜 ${format(dateTime.end, "HH:mm", { locale: ja })}`
        : "";

    const handleCopyUrl = () => {
        navigator.clipboard.writeText(icalUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleAddToGoogle = async () => {
        if (!dateTime) return;
        
        setIsAddingToGoogle(true);
        try {
            // 終日は日付のみ(排他的終了日)、それ以外はUTC日時のペア
            const dates = dateTime.allDay
                ? `${dateTime.date.replaceAll("-", "")}/${nextDateString(dateTime.date).replaceAll("-", "")}`
                : `${dateTime.start.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}/${dateTime.end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;

            const googleCalendarUrl = new URL("https://calendar.google.com/calendar/render");
            googleCalendarUrl.searchParams.set("action", "TEMPLATE");
            googleCalendarUrl.searchParams.set("text", eventTitle);
            googleCalendarUrl.searchParams.set("dates", dates);
            if (eventDescription) {
                googleCalendarUrl.searchParams.set("details", eventDescription);
            }
            
            window.open(googleCalendarUrl.toString(), "_blank");
            setAddedToGoogle(true);
        } finally {
            setIsAddingToGoogle(false);
        }
    };

    return (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <CalendarCheck className="h-5 w-5 text-emerald-600" />
                    <CardTitle className="text-lg text-emerald-700 dark:text-emerald-400">
                        日程が確定しました
                    </CardTitle>
                </div>
                <CardDescription className="text-emerald-600/80 dark:text-emerald-400/80">
                    以下の日程で決定しました
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-white p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <p className="font-semibold text-foreground" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>{budouxify(eventTitle)}</p>
                    <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                        {formattedDateTime}
                    </p>
                    {eventDescription && (
                        <p className="text-sm text-muted-foreground mt-2" style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>{budouxify(eventDescription)}</p>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="default"
                        size="sm"
                        asChild
                    >
                        <a href={webcalUrl} className="gap-2">
                            <ExternalLink className="h-4 w-4" />
                            カレンダーに追加
                        </a>
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyUrl}
                        className="gap-2"
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? "コピーしました" : "URLをコピー"}
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddToGoogle}
                        disabled={isAddingToGoogle || addedToGoogle}
                        className="gap-2"
                    >
                        {isAddingToGoogle ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <svg className="h-4 w-4" viewBox="0 0 24 24">
                                <path
                                    fill="currentColor"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="currentColor"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                            </svg>
                        )}
                        {addedToGoogle ? "Googleカレンダーを開きました" : "Googleカレンダーに追加"}
                    </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                    「カレンダーに追加」でカレンダーアプリが開きます。URLをコピーして手動で登録することもできます。
                </p>
            </CardContent>
        </Card>
    );
});
