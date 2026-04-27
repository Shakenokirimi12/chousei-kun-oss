"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { PeriodSelector, CUSTOM_PERIODS, HOURLY_SLOTS } from "@/components/PeriodSelector";
import { Loader2, Calendar as CalendarIcon, Check, Copy, ExternalLink, ArrowRight, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

import dynamic from 'next/dynamic';

const CampusSquareImport = dynamic(() => import('@/components/CampusSquareImport'), { ssr: false });

export function EventForm() {
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [adminPassword, setAdminPassword] = React.useState("");
    const [selectedPeriods, setSelectedPeriods] = React.useState<string[]>([]);
    const [showRestoreDialog, setShowRestoreDialog] = React.useState(false);
    const DRAFT_KEY = "chouseikun_draft_periods";

    React.useEffect(() => {
        const savedDraft = localStorage.getItem(DRAFT_KEY);
        if (savedDraft) {
            try {
                const parsed = JSON.parse(savedDraft);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setShowRestoreDialog(true);
                }
            } catch (e) {
                console.error("Failed to parse draft", e);
            }
        }
    }, []);

    React.useEffect(() => {
        if (selectedPeriods.length > 0) {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(selectedPeriods));
        }
    }, [selectedPeriods]);

    React.useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (selectedPeriods.length > 0 || title.length > 0) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [selectedPeriods, title]);
    const [universityBusyPeriods, setUniversityBusyPeriods] = React.useState<string[]>([]);
    const [googleData, setGoogleData] = React.useState<{ calendars: any[], events: any[] } | null>(null);
    const [selectedCalendarIds, setSelectedCalendarIds] = React.useState<string[]>([]);

    const mapEventsToPeriods = React.useCallback((events: any[], filterIds?: string[]) => {
        const newBusyPeriods: string[] = [];
        const filteredEvents = filterIds ? events.filter(e => filterIds.includes(e.calendarId)) : events;

        filteredEvents.forEach(event => {
            const startDate = new Date(event.dtstart || event.start);
            const endDate = new Date(event.dtend || event.end);
            const dateStr = startDate.toISOString().split("T")[0];

            const checkOverlap = (startA: Date, endA: Date, startB: Date, endB: Date) => {
                return startA < endB && endA > startB;
            }

            CUSTOM_PERIODS.forEach((p: any) => {
                const [startH, startM] = p.time.split("-")[0].split(":").map(Number);
                const [endH, endM] = p.time.split("-")[1].split(":").map(Number);

                const pStart = new Date(startDate);
                pStart.setHours(startH, startM, 0, 0);
                const pEnd = new Date(startDate);
                pEnd.setHours(endH, endM, 0, 0);

                if (checkOverlap(startDate, endDate, pStart, pEnd)) {
                    newBusyPeriods.push(`${dateStr}_P${p.id}`);
                }
            });

            HOURLY_SLOTS.forEach(h => {
                const [startH] = h.time.split("-")[0].split(":").map(Number);
                const pStart = new Date(startDate);
                pStart.setHours(startH, 0, 0, 0);
                const pEnd = new Date(startDate);
                pEnd.setHours(startH + 1, 0, 0, 0);

                if (checkOverlap(startDate, endDate, pStart, pEnd)) {
                    newBusyPeriods.push(`${dateStr}_H${h.id}`);
                }
            });

        });
        return [...new Set(newBusyPeriods)];
    }, []);

    const busyPeriods = React.useMemo(() => {
        const googleBusy = googleData ? mapEventsToPeriods(googleData.events, selectedCalendarIds) : [];
        return [...new Set([...universityBusyPeriods, ...googleBusy])];
    }, [universityBusyPeriods, googleData, selectedCalendarIds, mapEventsToPeriods]);
    const [isSubmitting, setIsSubmitting] = React.useState(false);

    // Import Dialog State
    const ENABLE_CAMPUS_SQUARE = process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE === 'true';

    // Feedback Dialog State
    const [feedback, setFeedback] = React.useState<{ title: string; message: string; isOpen: boolean }>({
        title: "",
        message: "",
        isOpen: false,
    });

    const closeFeedback = () => setFeedback(prev => ({ ...prev, isOpen: false }));

    const handleCampusSquareImport = async (uid: string, pass: string) => {
        if (!ENABLE_CAMPUS_SQUARE) return;

        const res = await fetch("/api/sync-calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid, pass }),
        });

        if (!res.ok) {
            const error = await res.json() as { error: string };
            throw new Error(error.error || "インポートに失敗しました");
        }

        const data = await res.json() as { events: { dtstart: string, dtend: string, summary: string }[] };
        const newBusyPeriods = mapEventsToPeriods(data.events);

        setUniversityBusyPeriods(prev => [...new Set([...prev, ...newBusyPeriods])]);
        setFeedback({
            title: "インポート成功",
            message: `${data.events.length}件の予定をインポートしました。これらは赤色で表示されます。`,
            isOpen: true
        });
    }

    React.useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data && event.data.type === 'GOOGLE_CALENDAR_EVENTS') {
                const gasData = event.data.data;
                setGoogleData(gasData);
                // 最初は全カレンダーを選択状態にする
                const allIds = gasData.calendars.map((c: any) => c.id);
                setSelectedCalendarIds(allIds);

                setFeedback({
                    title: "Googleカレンダー連携成功",
                    message: `${gasData.calendars.length}個のカレンダーから計${gasData.events.length}件の予定を同期しました。下のリストから表示・非表示を切り替えられます。`,
                    isOpen: true
                });
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const toggleCalendar = (id: string) => {
        setSelectedCalendarIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleGoogleImport = () => {
        const gasUrl = "https://script.google.com/macros/s/AKfycbxNI455hdkBLblowRBy00ok0VuF445oz60c8lCqvsUWN4v4H8SIclThLwXw9IDZoi6X/exec";
        window.open(gasUrl, "GoogleCalendarSync", "width=600,height=800");
    };



    const [createdEventId, setCreatedEventId] = React.useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title || selectedPeriods.length === 0) return;

        setIsSubmitting(true);
        try {
            // Sort candidates
            const sortedCandidates = [...selectedPeriods].sort((a, b) => {
                const [dateA, slotA] = a.split("_");
                const [dateB, slotB] = b.split("_");
                if (dateA !== dateB) return dateA.localeCompare(dateB);

                const getStartTime = (slot: string) => {
                    if (slot.startsWith("P")) {
                        const id = parseInt(slot.substring(1));
                        const p = CUSTOM_PERIODS.find((x: any) => x.id === id);
                        return p ? p.time.split("-")[0] : "00:00";
                    } else if (slot.startsWith("H")) {
                        const id = parseInt(slot.substring(1));
                        return `${id.toString().padStart(2, '0')}:00`;
                    } else {
                        const id = parseInt(slot);
                        const p = CUSTOM_PERIODS.find((x: any) => x.id === id);
                        return p ? p.time.split("-")[0] : "00:00";
                    }
                }
                return getStartTime(slotA).localeCompare(getStartTime(slotB));
            });

            const response = await fetch("/api/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, description, candidates: sortedCandidates, adminPassword }),
            });

            if (!response.ok) throw new Error("イベントの作成に失敗しました");

            const data = await response.json() as { id: string };
            setCreatedEventId(data.id);
            localStorage.removeItem(DRAFT_KEY);
            setIsModalOpen(false);
            // router.push(`/${data.id}`); // Removed to show success UI
        } catch (error) {
            console.error(error);
            setFeedback({
                title: "エラー",
                message: "イベントの作成に失敗しました。もう一度お試しください。",
                isOpen: true
            });
        } finally {
            setIsSubmitting(false);
        }
    };



    // ... existing code ...

    if (createdEventId) {
        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const participantUrl = `${baseUrl}/${createdEventId}`;
        const resultsUrl = `${baseUrl}/${createdEventId}/results`;
        const adminUrl = `${baseUrl}/${createdEventId}/admin`;

        const copyToClipboard = (text: string, label: string) => {
            navigator.clipboard.writeText(text);
            setFeedback({
                title: "コピーしました",
                message: `${label}をクリップボードにコピーしました。`,
                isOpen: true
            });
        };

        return (
            <div className="w-full animate-in fade-in zoom-in-95 duration-500">
                <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur-md shadow-2xl overflow-hidden">
                    <CardHeader className="text-center pb-2">
                        <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                            <Check className="w-10 h-10 text-primary" />
                        </div>
                        <CardTitle className="text-3xl font-bold">イベントを作成しました！</CardTitle>
                        <CardDescription className="text-lg">以下のURLを共有・保存してください。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl border bg-background/50 space-y-3">
                                <h4 className="font-bold flex items-center gap-2 text-primary">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs">1</span>
                                    回答用 URL (参加者に共有)
                                </h4>
                                <div className="flex gap-2">
                                    <Input value={participantUrl} readOnly className="bg-muted/50" />
                                    <Button size="icon" variant="outline" onClick={() => copyToClipboard(participantUrl, "回答用URL")}>
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                                <p className="text-[10px] text-muted-foreground">参加者が日程を回答するためのURLです。SNSやメールで共有してください。</p>
                            </div>

                            <div className="p-4 rounded-xl border bg-background/50 space-y-3">
                                <h4 className="font-bold flex items-center gap-2 text-orange-500">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-500 text-white text-xs">2</span>
                                    結果確認 URL (参加者向け)
                                </h4>
                                <div className="flex gap-2">
                                    <Input value={resultsUrl} readOnly className="bg-muted/50" />
                                    <Button size="icon" variant="outline" onClick={() => copyToClipboard(resultsUrl, "結果確認URL")}>
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                                <p className="text-[10px] text-muted-foreground">回答状況を公開して確認するためのURLです。</p>
                            </div>

                            <div className="p-4 rounded-xl border bg-background/50 space-y-3">
                                <h4 className="font-bold flex items-center gap-2 text-orange-500">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-500 text-white text-xs">3</span>
                                    管理用 URL (あなた専用)
                                </h4>
                                <div className="flex gap-2">
                                    <Input value={adminUrl} readOnly className="bg-muted/50" />
                                    <Button size="icon" variant="outline" onClick={() => copyToClipboard(adminUrl, "管理用URL")}>
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                                <p className="text-[10px] text-muted-foreground">回答状況を確認し、最終日程を決定するためのプライベートなURLです。</p>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3 pb-8">
                        <Link href={`/${createdEventId}`} className="w-full">
                            <Button className="w-full py-6 text-lg gap-2" size="lg">
                                回答画面へ移動 <ArrowRight className="h-5 w-5" />
                            </Button>
                        </Link>
                        <Link href={`/${createdEventId}/admin`} className="w-full">
                            <Button variant="ghost" className="w-full gap-2">
                                管理画面で設定を行う <ExternalLink className="h-4 w-4" />
                            </Button>
                        </Link>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full max-w-none mx-auto h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-2 sm:mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center shrink-0 gap-4">
                <div className="text-left flex items-center gap-4">
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                            {siteConfig.ui.createEvent.title}
                        </h2>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                            {siteConfig.ui.createEvent.description}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <Button
                        type="button"
                        onClick={() => setIsModalOpen(true)}
                        disabled={selectedPeriods.length === 0}
                        size="sm"
                        className="shadow-sm"
                    >
                        次へ (詳細を設定) <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="flex-1 min-h-0 relative overflow-hidden w-full flex flex-col">
                <div className="space-y-2 shrink-0 pb-2 top-0 bg-background/95 backdrop-blur z-10">
                    <div className="flex justify-between items-end flex-wrap gap-2">
                        <label className="text-xs font-medium leading-none shrink-0 text-muted-foreground">
                            候補日程の選択
                        </label>
                        <div className="flex gap-2">
                            {ENABLE_CAMPUS_SQUARE && (
                                <CampusSquareImport onImport={handleCampusSquareImport} />
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 relative bg-transparent sm:bg-card/10 sm:border rounded-lg overflow-hidden flex flex-col">
                    <PeriodSelector
                        selectedPeriods={selectedPeriods}
                        onChange={setSelectedPeriods}
                        busyPeriods={busyPeriods}
                    />
                </div>
            </div>

            {/* Input Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>イベントの詳細を設定</DialogTitle>
                            <DialogDescription>
                                イベントのタイトルと説明を入力して作成を完了します。
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6 py-6">
                            <div className="space-y-2">
                                <label htmlFor="title" className="text-sm font-medium leading-none">
                                    イベント名 <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="title"
                                    placeholder="例: プロジェクト会議、ランチなど"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    required
                                    className="text-lg py-6 bg-background/50 backdrop-blur-sm"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="description" className="text-sm font-medium leading-none">
                                    説明 (任意)
                                </label>
                                <Input
                                    id="description"
                                    placeholder="詳細を追加..."
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="bg-background/50 backdrop-blur-sm"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="adminPassword" className="text-sm font-medium leading-none">
                                    管理者パスワード <span className="text-red-500">*</span>
                                </label>
                                <Input
                                    id="adminPassword"
                                    type="password"
                                    placeholder="6文字以上"
                                    value={adminPassword}
                                    onChange={(e) => setAdminPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    className="bg-background/50 backdrop-blur-sm"
                                />
                                <p className="text-xs text-muted-foreground">管理画面の閲覧に必要です。忘れないようにしてください。</p>
                            </div>
                        </div>
                        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)} className="w-full sm:w-auto">
                                キャンセル
                            </Button>
                            <Button
                                type="submit"
                                disabled={!title || adminPassword.length < 6 || isSubmitting}
                                className="w-full sm:w-auto shadow-lg shadow-primary/20"
                            >
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                イベントを作成
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Restore Draft Dialog */}
            <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>下書きの復元</DialogTitle>
                        <DialogDescription>
                            前回選択した日程のデータが残っています。復元して続きから作成しますか？
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => {
                                localStorage.removeItem(DRAFT_KEY);
                                setShowRestoreDialog(false);
                            }}
                        >
                            破棄する
                        </Button>
                        <Button
                            onClick={() => {
                                const savedDraft = localStorage.getItem(DRAFT_KEY);
                                if (savedDraft) {
                                    setSelectedPeriods(JSON.parse(savedDraft));
                                }
                                setShowRestoreDialog(false);
                            }}
                        >
                            復元する
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={feedback.isOpen} onOpenChange={closeFeedback}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{feedback.title}</DialogTitle>
                        <DialogDescription>
                            {feedback.message}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={closeFeedback}>閉じる</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
