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
    const [step, setStep] = React.useState(1);
    const [title, setTitle] = React.useState("");
    const [description, setDescription] = React.useState("");
    const [selectedPeriods, setSelectedPeriods] = React.useState<string[]>([]);
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
                body: JSON.stringify({ title, description, candidates: sortedCandidates }),
            });

            if (!response.ok) throw new Error("イベントの作成に失敗しました");

            const data = await response.json() as { id: string };
            setCreatedEventId(data.id);
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
            <div className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500">
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
                                管理画面で回答状況を見る <ExternalLink className="h-4 w-4" />
                            </Button>
                        </Link>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="w-full max-w-none mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="mb-8 flex justify-between items-start">
                <div className="text-center sm:text-left">
                    <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                        {siteConfig.ui.createEvent.title}
                    </h2>
                    <p className="text-muted-foreground mt-2">
                        {siteConfig.ui.createEvent.description}
                    </p>
                </div>
            </div>

            {/* Stepper Indicator */}
            <div className="mb-8 flex items-center justify-center sm:justify-start gap-4 text-sm font-medium">
                <div className={`flex items-center gap-2 ${step >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs ${step >= 1 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>1</div>
                    タイトルと説明の入力
                </div>
                <div className="w-12 h-[2px] bg-muted overflow-hidden relative">
                    <div className={`absolute left-0 top-0 h-full bg-primary transition-all duration-300 ${step >= 2 ? 'w-full' : 'w-0'}`} />
                </div>
                <div className={`flex items-center gap-2 ${step >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs ${step >= 2 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>2</div>
                    カレンダーの設定
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8 relative overflow-hidden min-h-[400px]">
                {/* Step 1: Basic Info */}
                <div className={`transition-all duration-300 absolute inset-0 space-y-8 ${step === 1 ? 'opacity-100 translate-x-0 relative' : 'opacity-0 -translate-x-12 pointer-events-none'}`}>
                    <div className="space-y-2">
                        <label htmlFor="title" className="text-sm font-medium leading-none">
                            イベント名 <span className="text-red-500">*</span>
                        </label>
                        <Input
                            id="title"
                            placeholder="例: プロジェクト会議、ランチなど"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            required={step === 1}
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

                    <div className="flex flex-col sm:flex-row justify-end gap-4 pt-4">
                        <Button variant="ghost" onClick={() => router.back()} type="button" className="w-full sm:w-auto">
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={!title}
                            size="lg"
                            className="w-full sm:w-auto shadow-sm"
                        >
                            次へ (カレンダーの設定) <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Step 2: Date/Time Selection */}
                <div className={`transition-all duration-300 absolute inset-0 space-y-6 ${step === 2 ? 'opacity-100 translate-x-0 relative' : 'opacity-0 translate-x-12 pointer-events-none'}`}>
                    <div className="space-y-4">
                        <div className="flex justify-between items-end flex-wrap gap-2">
                            <label className="text-sm font-medium leading-none shrink-0">
                                候補日程の選択
                            </label>
                            <div className="flex gap-2">
                                {/* <Button variant="outline" size="sm" type="button" onClick={handleGoogleImport} className="gap-2">
                                <CalendarIcon className="h-4 w-4" />
                                Googleカレンダー
                            </Button> */}
                                {ENABLE_CAMPUS_SQUARE && (
                                    <CampusSquareImport onImport={handleCampusSquareImport} />
                                )}
                            </div>
                        </div>

                        {/* {googleData && (
                        <div className="p-4 rounded-lg border bg-card/50 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-500">
                            <h4 className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">表示するカレンダーを選択</h4>
                            <div className="flex flex-wrap gap-2">
                                {googleData.calendars.map(cal => (
                                    <button
                                        key={cal.id}
                                        type="button"
                                        onClick={() => toggleCalendar(cal.id)}
                                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 flex items-center gap-2 border ${selectedCalendarIds.includes(cal.id)
                                            ? 'bg-primary/10 border-primary text-primary shadow-sm'
                                            : 'bg-background border-border text-muted-foreground hover:border-muted-foreground/30'
                                            }`}
                                    >
                                        <div
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: cal.color || '#4285f4' }}
                                        />
                                        {cal.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )} */}
                    </div>

                    <div className="p-0 sm:p-4 rounded-lg sm:border bg-transparent sm:bg-card/30">
                        <PeriodSelector
                            selectedPeriods={selectedPeriods}
                            onChange={setSelectedPeriods}
                            busyPeriods={busyPeriods}
                        />
                    </div>
                </div>

                <div className={`flex flex-col sm:flex-row justify-end gap-4 pt-4 transition-all duration-300 ${step === 2 ? 'opacity-100' : 'opacity-0 pointer-events-none hidden'}`}>
                    <Button variant="ghost" onClick={() => setStep(1)} type="button" className="w-full sm:w-auto gap-2">
                        <ArrowLeft className="h-4 w-4" /> 戻る
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!title || selectedPeriods.length === 0 || isSubmitting}
                        size="lg"
                        className="w-full sm:w-auto shadow-lg shadow-primary/20"
                    >
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        イベントを作成
                    </Button>
                </div>
            </form>

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
