"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, Send, X, Calendar as CalendarIcon, GraduationCap, User, ArrowLeft, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

interface Message {
    role: "user" | "assistant";
    content: string;
}

interface AISchedulingAssistantProps {
    currentSchedule: string[];
    onChange: (updated: string[]) => void;
    mode: "create" | "respond";
    candidates?: string[];
    universityCredentials?: { uid: string; pass: string };
    icalUrl?: string;
    isOpen: boolean;
    onOpen: () => void;
    onClose: () => void;
}

export default function AISchedulingAssistant({
    currentSchedule,
    onChange,
    mode,
    candidates,
    universityCredentials,
    icalUrl,
    isOpen,
    onOpen,
    onClose,
}: AISchedulingAssistantProps) {
    const [prompt, setPrompt] = React.useState("");
    const [isLoading, setIsLoading] = React.useState(false);
    const [messages, setMessages] = React.useState<Message[]>([
        { role: "assistant", content: "こんにちは！日程調整のお手伝いをします。指示を入力してください。" }
    ]);
    
    // Toggle states for AI context
    const [useGoogleCalendar, setUseGoogleCalendar] = React.useState(false);
    const [isGoogleLoggedIn, setIsGoogleLoggedIn] = React.useState<boolean | null>(null);

    // Check Google Login status
    React.useEffect(() => {
        const checkLogin = async () => {
            try {
                const res = await fetch("/api/google/session-status");
                const data = await res.json() as { loggedIn: boolean };
                setIsGoogleLoggedIn(data.loggedIn);
            } catch (e) {
                setIsGoogleLoggedIn(false);
            }
        };
        checkLogin();
    }, [isOpen]);

    const handleGoogleToggle = () => {
        // If already enabled, just toggle off
        if (useGoogleCalendar) {
            setUseGoogleCalendar(false);
            return;
        }

        // If trying to enable but not logged in, redirect to auth
        if (isGoogleLoggedIn === false) {
            const url = new URL(window.location.href);
            const returnTo = encodeURIComponent(url.pathname + url.search);
            window.location.href = `/api/google/auth/start?returnTo=${returnTo}`;
            return;
        }

        // Otherwise (logged in or status unknown), allow toggle
        setUseGoogleCalendar(true);
    };
    const [useUniversityCalendar, setUseUniversityCalendar] = React.useState(false);
    const [showUniCredsDialog, setShowUniversityCredentialsDialog] = React.useState(false);
    const [uniCreds, setUniCreds] = React.useState<{uid: string, pass: string} | null>(null);

    const handleUniToggle = () => {
        if (!useUniversityCalendar && !uniCreds && !universityCredentials) {
            setShowUniversityCredentialsDialog(true);
        } else {
            setUseUniversityCalendar(!useUniversityCalendar);
        }
    };

    const handleUniCredsSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const uid = formData.get("uid") as string;
        const pass = formData.get("pass") as string;
        if (uid && pass) {
            setUniCreds({ uid, pass });
            setUseUniversityCalendar(true);
            setShowUniversityCredentialsDialog(false);
        }
    };

    const scrollRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isLoading]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt || isLoading) return;

        const userMessage = prompt;
        setPrompt("");
        setMessages(prev => [...prev, { role: "user", content: userMessage }]);
        setIsLoading(true);

        try {
            const res = await fetch("/api/ai/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: userMessage,
                    history: messages.slice(1), 
                    currentSchedule,
                    mode,
                    candidates,
                    universityCredentials: uniCreds || universityCredentials,
                    icalUrl,
                    useGoogleCalendar,
                    useUniversityCalendar,
                }),
            });

            if (!res.ok) {
                const error = await res.json() as { error: string };
                throw new Error(error.error || "AIアシスタントとの通信に失敗しました");
            }

            const data = await res.json() as { text: string; updatedSchedule?: string[]; message?: string, toolCalls?: string[] };
            
            if (data.updatedSchedule) {
                onChange(data.updatedSchedule);
            }
            
            setMessages(prev => [...prev, { role: "assistant", content: data.message || data.text }]);
        } catch (error: any) {
            setMessages(prev => [...prev, { role: "assistant", content: `エラーが発生しました: ${error.message}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    const getToolNameJP = (name: string) => {
        switch (name) {
            case "fetch_google_calendar": return "Googleカレンダー";
            case "fetch_university_calendar": return "大学の予定";
            case "fetch_ical_calendar": return "外部iCal";
            case "update_schedule": return "日程の反映";
            default: return name;
        }
    };

    return (
        <>
            {/* Fixed Floating Toggle Tab */}
            {!isOpen && (
                <button
                    onClick={() => onOpen()}
                    className="hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-40 flex-col items-center gap-2 px-2 py-6 rounded-l-2xl bg-gradient-to-b from-primary to-primary/80 text-primary-foreground shadow-xl hover:pr-3 transition-all group animate-in slide-in-from-right duration-500"
                    title="AI日程調整を開く"
                >
                    <Sparkles className="h-5 w-5 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-bold [writing-mode:vertical-rl] tracking-widest uppercase">AI Assistant</span>
                    <ArrowLeft className="h-3 w-3 mt-2 opacity-70 group-hover:-translate-x-1 transition-transform" />
                </button>
            )}

            {/* Side Pane */}
            {isOpen && (
                <div className="hidden md:flex w-full lg:w-80 h-[calc(100%-1rem)] m-2 flex-col bg-card/80 backdrop-blur-xl border rounded-2xl shadow-2xl animate-in slide-in-from-right duration-300 ring-1 ring-primary/10 overflow-hidden relative z-50">
                    <div className="p-4 border-b flex items-center justify-between bg-primary/10">
                        <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            <span className="font-bold text-sm text-primary flex items-center gap-1.5">
                                AI日程調整
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/20 leading-none">
                                    ベータ版
                                </span>
                            </span>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 hover:bg-primary/10">
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="p-4 border-b bg-muted/30 space-y-3">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">カレンダー連携設定</h4>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={handleGoogleToggle}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all shadow-sm",
                                    useGoogleCalendar 
                                        ? "bg-green-500/15 border-green-500 text-green-700 dark:text-green-400 shadow-green-500/10" 
                                        : "bg-background border-border opacity-50 grayscale"
                                )}
                            >
                                <div className="flex items-center gap-1.5">
                                    <div className={cn(
                                        "p-1.5 rounded-lg",
                                        useGoogleCalendar ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"
                                    )}>
                                        <CalendarIcon className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-xs font-bold block leading-none">Google</span>
                                    <span className={cn(
                                        "text-[8px] font-medium px-1 rounded-sm block mx-auto w-fit",
                                        isGoogleLoggedIn === true ? "bg-green-500/20 text-green-600" : "bg-yellow-500/20 text-yellow-600"
                                    )}>
                                        {isGoogleLoggedIn === true ? "連携済み" : "未連携"}
                                    </span>
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={handleUniToggle}
                                className={cn(
                                    "flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border-2 transition-all shadow-sm",
                                    useUniversityCalendar 
                                        ? "bg-blue-500/15 border-blue-500 text-blue-700 dark:text-blue-400 shadow-blue-500/10" 
                                        : "bg-background border-border opacity-50 grayscale"
                                )}
                            >
                                <div className="flex items-center gap-1.5">
                                    <div className={cn(
                                        "p-1.5 rounded-lg",
                                        useUniversityCalendar ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground"
                                    )}>
                                        <GraduationCap className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                                <div className="space-y-0.5">
                                    <span className="text-xs font-bold block leading-none">大学予定</span>
                                    <span className={cn(
                                        "text-[8px] font-medium px-1 rounded-sm block mx-auto w-fit",
                                        (uniCreds || universityCredentials) ? "bg-blue-500/20 text-blue-600" : "bg-muted text-muted-foreground"
                                    )}>
                                        {(uniCreds || universityCredentials) ? "設定済み" : "未設定"}
                                    </span>
                                </div>
                            </button>
                        </div>

                    </div>

                    <ScrollArea className="flex-1 min-h-0" viewportRef={scrollRef}>
                        <div className="p-4 space-y-4">
                            {messages.map((msg, i) => (
                                <div key={i} className={cn(
                                    "flex gap-2 max-w-[85%]",
                                    msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                                )}>
                                    <div className={cn(
                                        "h-6 w-6 rounded-full flex items-center justify-center shrink-0 mt-1",
                                        msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                    )}>
                                        {msg.role === "user" ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                                    </div>
                                    <div className={cn(
                                        "p-3 rounded-2xl text-[13px] leading-relaxed shadow-sm",
                                        msg.role === "user" 
                                            ? "bg-primary text-primary-foreground rounded-tr-none" 
                                            : "bg-muted text-foreground rounded-tl-none"
                                    )}>
                                        {msg.content}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex gap-2 mr-auto max-w-[85%]">
                                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                                    </div>
                                    <div className="p-3 rounded-2xl rounded-tl-none bg-muted text-muted-foreground text-[13px] space-y-2 shadow-sm border border-border/50">
                                        <div className="flex flex-col gap-1.5">
                                            {(useGoogleCalendar || useUniversityCalendar || icalUrl) && (
                                                <div className="flex items-center gap-2 text-xs text-primary/70 font-medium bg-primary/5 p-1.5 rounded-md border border-primary/10">
                                                    <Database className="h-3 w-3 animate-pulse" />
                                                    <span>外部カレンダーを確認中...</span>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 py-1 px-1">
                                                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                                <span className="font-medium text-xs">AIが日程を調整しています...</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </ScrollArea>

                    <div className="p-4 border-t bg-background/50">
                        <form onSubmit={handleSend} className="flex gap-2">
                            <Input
                                placeholder="指示を入力..."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                disabled={isLoading}
                                className="text-xs h-9 bg-background/50"
                            />
                            <Button type="submit" disabled={isLoading || !prompt} size="icon" className="h-9 w-9 shrink-0">
                                <Send className="h-4 w-4" />
                            </Button>
                        </form>
                    </div>

                    {/* University Credentials Dialog */}
                    <Dialog open={showUniCredsDialog} onOpenChange={setShowUniversityCredentialsDialog}>
                        <DialogContent className="sm:max-w-xs">
                            <DialogHeader>
                                <DialogTitle className="text-sm">大学システム連携</DialogTitle>
                                <DialogDescription className="text-xs">
                                    AIが予定を取得するために、学内システムのIDとパスワードが必要です。
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleUniCredsSubmit} className="space-y-4 py-2">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase text-muted-foreground">User ID</label>
                                    <Input name="uid" placeholder="学籍番号など" required className="h-8 text-xs" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium uppercase text-muted-foreground">Password</label>
                                    <Input name="pass" type="password" placeholder="パスワード" required className="h-8 text-xs" />
                                </div>
                                <DialogFooter className="flex-col gap-2">
                                    <Button type="submit" size="sm" className="w-full text-xs">認証して連携</Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            )}
        </>
    );
}
