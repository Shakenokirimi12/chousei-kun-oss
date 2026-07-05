"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BellOff, Calendar, Loader2, Check, Copy, ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { logActivity } from "@/hooks/useActivityLog";

type Props = {
    eventId: string;
    eventTitle: string;
};

type CalendarPreference = "google" | "ical-event" | "ical-all" | "none";

export function ResponseCompleteForm({ eventId, eventTitle }: Props) {
    const { userInfo, isLoading: isUserLoading, regenerateCalendarToken, getCalendarUrl } = useUser();
    const [participantId, setParticipantId] = useState<string | null>(null);
    const [notificationEmail, setNotificationEmail] = useState("");
    const [calendarPreference, setCalendarPreference] = useState<CalendarPreference>("none");
    const [hasGoogleSession, setHasGoogleSession] = useState(false);
    const [googleEmail, setGoogleEmail] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [copiedEvent, setCopiedEvent] = useState(false);
    const [copiedAll, setCopiedAll] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);

    const trimmedNotificationEmail = notificationEmail.trim();
    const isEmailInvalid = trimmedNotificationEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedNotificationEmail);

    const isLocalhost = typeof window !== "undefined" && window.location.hostname === "localhost";
    
    const eventIcalUrl = typeof window !== "undefined" 
        ? `${window.location.origin}/api/events/${eventId}/calendar.ics`
        : "";
    const eventWebcalUrl = isLocalhost ? eventIcalUrl : eventIcalUrl.replace(/^https?:/, "webcal:");

    const allEventsIcalUrl = getCalendarUrl();
    const allEventsWebcalUrl = isLocalhost 
        ? allEventsIcalUrl 
        : allEventsIcalUrl?.replace(/^https?:/, "webcal:") ?? null;

    useEffect(() => {
        const storedId = localStorage.getItem(`chosei_participant_${eventId}`);
        if (storedId) {
            setParticipantId(storedId);
        }
    }, [eventId]);

    useEffect(() => {
        const checkGoogleSession = async () => {
            try {
                const res = await fetch("/api/google/session-status");
                if (!res.ok) return;
                const data = await res.json() as {
                    hasSession: boolean;
                    email: string | null;
                };
                // このフローは通知先メールの本人確認のみに Google ログインを使い、
                // カレンダーへの読み書きは行わないため、カレンダースコープの有無は問わない。
                setHasGoogleSession(data.hasSession);
                if (data.email) {
                    setGoogleEmail(data.email);
                    if (!notificationEmail) {
                        setNotificationEmail(data.email);
                    }
                }
            } catch {
                // Ignore
            }
        };
        checkGoogleSession();
    }, []);

    const handleSave = async () => {
        if (!participantId) return;
        
        logActivity("通知設定保存開始", `preference: ${calendarPreference}`);
        setIsSaving(true);
        setSaved(false);
        setSaveError(null);

        try {
            const res = await fetch(`/api/events/${eventId}/notification`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    participantId,
                    notifyOnFinalize: calendarPreference === "google",
                    notificationEmail: notificationEmail.trim() || googleEmail || "",
                }),
            });

            if (!res.ok) {
                const data = await res.json() as { error?: string };
                logActivity("通知設定保存失敗", data.error || "不明なエラー");
                throw new Error(data.error || "保存に失敗しました");
            }

            logActivity("通知設定保存成功");
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (error) {
            console.error(error);
            setSaveError(error instanceof Error ? error.message : "保存に失敗しました。もう一度お試しください。");
        } finally {
            setIsSaving(false);
        }
    };

    const handleGoogleConnect = () => {
        logActivity("Googleログイン開始");
        const returnTo = encodeURIComponent(window.location.pathname);
        // 通知先メール確認のためだけの本人確認。カレンダーへの読み書きは行わない
        window.location.href = `/api/google/auth/start?returnTo=${returnTo}&scope=basic`;
    };

    const handleRegenerateToken = async () => {
        logActivity("カレンダートークン再生成開始");
        setIsRegenerating(true);
        try {
            await regenerateCalendarToken();
            logActivity("カレンダートークン再生成成功");
        } finally {
            setIsRegenerating(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    カレンダー連携
                </CardTitle>
                <CardDescription>
                    確定した日程をカレンダーに自動で追加できます
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4">
                    <p className="text-sm font-medium">カレンダーへの追加方法を選択</p>
                    
                    <div className="grid gap-3">
                        <button
                            type="button"
                            onClick={() => setCalendarPreference("google")}
                            className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                                calendarPreference === "google"
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:bg-muted/50"
                            }`}
                        >
                            <div className={`mt-0.5 rounded-full p-1 ${
                                calendarPreference === "google" ? "bg-primary text-primary-foreground" : "bg-muted"
                            }`}>
                                <svg className="h-4 w-4" viewBox="0 0 24 24">
                                    <path
                                        fill="currentColor"
                                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                    />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <p className="font-medium">Googleカレンダーに自動追加</p>
                                <p className="text-sm text-muted-foreground">
                                    {hasGoogleSession && googleEmail 
                                        ? `${googleEmail} に招待が届きます`
                                        : "日程確定時にGoogleカレンダーに予定が追加されます"
                                    }
                                </p>
                            </div>
                            {calendarPreference === "google" && (
                                <Check className="h-5 w-5 text-primary" />
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setCalendarPreference("ical-all")}
                            className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                                calendarPreference === "ical-all"
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:bg-muted/50"
                            }`}
                        >
                            <div className={`mt-0.5 rounded-full p-1 ${
                                calendarPreference === "ical-all" ? "bg-primary text-primary-foreground" : "bg-muted"
                            }`}>
                                <Calendar className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                                <p className="font-medium">マイカレンダーを購読（おすすめ）</p>
                                <p className="text-sm text-muted-foreground">
                                    参加した全イベントの確定日程が自動で反映されます
                                </p>
                            </div>
                            {calendarPreference === "ical-all" && (
                                <Check className="h-5 w-5 text-primary" />
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setCalendarPreference("ical-event")}
                            className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                                calendarPreference === "ical-event"
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:bg-muted/50"
                            }`}
                        >
                            <div className={`mt-0.5 rounded-full p-1 ${
                                calendarPreference === "ical-event" ? "bg-primary text-primary-foreground" : "bg-muted"
                            }`}>
                                <Calendar className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                                <p className="font-medium">このイベントのみ購読</p>
                                <p className="text-sm text-muted-foreground">
                                    「{eventTitle}」の日程のみ購読します
                                </p>
                            </div>
                            {calendarPreference === "ical-event" && (
                                <Check className="h-5 w-5 text-primary" />
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setCalendarPreference("none")}
                            className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-colors ${
                                calendarPreference === "none"
                                    ? "border-primary bg-primary/5"
                                    : "border-border hover:bg-muted/50"
                            }`}
                        >
                            <div className={`mt-0.5 rounded-full p-1 ${
                                calendarPreference === "none" ? "bg-primary text-primary-foreground" : "bg-muted"
                            }`}>
                                <BellOff className="h-4 w-4" />
                            </div>
                            <div className="flex-1">
                                <p className="font-medium">今は設定しない</p>
                                <p className="text-sm text-muted-foreground">
                                    結果ページでいつでも設定できます
                                </p>
                            </div>
                            {calendarPreference === "none" && (
                                <Check className="h-5 w-5 text-primary" />
                            )}
                        </button>
                    </div>

                    {calendarPreference === "google" && !hasGoogleSession && (
                        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                            <p className="text-sm font-medium">Googleアカウントと連携</p>
                            <p className="text-sm text-muted-foreground">
                                Googleカレンダーへの自動追加にはGoogleアカウントとの連携が必要です
                            </p>
                            <Button
                                type="button"
                                variant="default"
                                onClick={handleGoogleConnect}
                                className="gap-2 w-full"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24">
                                    <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                </svg>
                                Googleアカウントでログイン
                            </Button>
                        </div>
                    )}

                    {calendarPreference === "google" && hasGoogleSession && (
                        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                            <div className="flex items-center gap-2 text-sm">
                                <Check className="h-4 w-4 text-green-600" />
                                <span className="text-green-600 font-medium">Googleアカウント連携済み</span>
                                {googleEmail && <span className="text-muted-foreground">({googleEmail})</span>}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    通知先メールアドレス
                                </label>
                                <Input
                                    type="email"
                                    value={notificationEmail}
                                    onChange={(e) => setNotificationEmail(e.target.value)}
                                    placeholder="example@gmail.com"
                                    aria-invalid={isEmailInvalid}
                                    className={isEmailInvalid ? "border-destructive focus-visible:ring-destructive" : undefined}
                                />
                                {isEmailInvalid && (
                                    <p className="text-xs text-destructive">メールアドレスの形式が正しくありません。</p>
                                )}
                            </div>
                        </div>
                    )}

                    {calendarPreference === "ical-all" && (
                        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                            <div className="space-y-2">
                                <p className="text-sm font-medium">マイカレンダーを登録</p>
                                <p className="text-xs text-muted-foreground">
                                    このURLを購読すると、参加した全イベントの確定日程が自動で反映されます
                                </p>
                            </div>
                            
                            {isUserLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    読み込み中...
                                </div>
                            ) : allEventsIcalUrl ? (
                                <>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="default"
                                            size="sm"
                                            asChild
                                        >
                                            <a href={allEventsWebcalUrl ?? ""} className="gap-2">
                                                <ExternalLink className="h-4 w-4" />
                                                カレンダーに追加
                                            </a>
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                if (allEventsIcalUrl) {
                                                    navigator.clipboard.writeText(allEventsIcalUrl);
                                                    setCopiedAll(true);
                                                    setTimeout(() => setCopiedAll(false), 2000);
                                                }
                                            }}
                                            className="gap-2"
                                        >
                                            {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                            {copiedAll ? "コピーしました" : "URLをコピー"}
                                        </Button>
                                    </div>

                                    <div className="border-t pt-3 mt-3">
                                        <div className="flex items-start gap-2 text-xs text-muted-foreground">
                                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                            <div className="space-y-1">
                                                <p>このURLは他の人に共有しないでください。</p>
                                                <p>漏洩した場合は下のボタンで再生成できます。</p>
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleRegenerateToken}
                                            disabled={isRegenerating}
                                            className="gap-2 mt-2"
                                        >
                                            {isRegenerating ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4" />
                                            )}
                                            URLを再生成
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <p className="text-sm text-destructive">カレンダーURLの取得に失敗しました</p>
                            )}
                        </div>
                    )}

                    {calendarPreference === "ical-event" && (
                        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                            <p className="text-sm font-medium">このイベントのカレンダーを登録</p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    size="sm"
                                    asChild
                                >
                                    <a href={eventWebcalUrl} className="gap-2">
                                        <ExternalLink className="h-4 w-4" />
                                        カレンダーに追加
                                    </a>
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        navigator.clipboard.writeText(eventIcalUrl);
                                        setCopiedEvent(true);
                                        setTimeout(() => setCopiedEvent(false), 2000);
                                    }}
                                    className="gap-2"
                                >
                                    {copiedEvent ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    {copiedEvent ? "コピーしました" : "URLをコピー"}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                「カレンダーに追加」でカレンダーアプリが開きます。URLをコピーして手動で登録することもできます。
                            </p>
                        </div>
                    )}
                </div>

                {participantId && calendarPreference === "google" && hasGoogleSession && (
                    <div className="space-y-2">
                        <Button
                            onClick={handleSave}
                            disabled={isSaving || !notificationEmail.trim() || isEmailInvalid}
                            className="w-full"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    保存中...
                                </>
                            ) : saved ? (
                                <>
                                    <Check className="mr-2 h-4 w-4" />
                                    保存しました
                                </>
                            ) : (
                                "設定を保存"
                            )}
                        </Button>
                        {saveError && (
                            <p className="text-sm text-destructive">{saveError}</p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
