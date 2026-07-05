"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { HelpCircle, Send, Trash2, Mail, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { getActivityLogs, clearActivityLogs, formatLogsForEmail } from "@/hooks/useActivityLog";
import { budouxify } from "@/lib/budoux";

// 運用者ごとに変わる連絡先。フォーク/セルフホスト時は環境変数で差し替える。
const FEEDBACK_EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "feedback@example.com";

export function FeedbackButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState<string>("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLogs(formatLogsForEmail());
        }
    }, [isOpen]);

    const handleClearLogs = () => {
        clearActivityLogs();
        setLogs("ログがありません");
    };

    const handleCopyLogs = () => {
        navigator.clipboard.writeText(logs);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const generateMailtoLink = () => {
        const subject = encodeURIComponent("【調整くん】フィードバック");
        
        const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "不明";
        const currentUrl = typeof window !== "undefined" ? window.location.href : "不明";
        const screenSize = typeof window !== "undefined" 
            ? `${window.innerWidth}x${window.innerHeight}` 
            : "不明";
        
        const body = encodeURIComponent(
`【フィードバック内容】
${message || "(未入力)"}

---
【環境情報】
URL: ${currentUrl}
画面サイズ: ${screenSize}
ブラウザ: ${userAgent}

---
【操作ログ】
${logs}
`
        );

        return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="fixed bottom-4 right-4 gap-2 shadow-lg z-50"
                >
                    <HelpCircle className="h-4 w-4" />
                    ヘルプ
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <HelpCircle className="h-5 w-5" />
                        <span style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>{budouxify("ヘルプ・フィードバック")}</span>
                    </DialogTitle>
                    <DialogDescription style={{ wordBreak: "keep-all", overflowWrap: "anywhere" }}>
                        {budouxify("バグ報告や機能リクエストをお送りください。操作ログを一緒に送ると解決が早くなります。")}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">
                            フィードバック内容
                        </label>
                        <Textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="問題の詳細や改善要望をお書きください..."
                            rows={4}
                        />
                    </div>

                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={() => setShowLogs(!showLogs)}
                            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showLogs ? (
                                <ChevronUp className="h-4 w-4" />
                            ) : (
                                <ChevronDown className="h-4 w-4" />
                            )}
                            操作ログを確認 ({getActivityLogs().length}件)
                        </button>

                        {showLogs && (
                            <div className="space-y-2">
                                <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto">
                                    <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                                        {logs}
                                    </pre>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleCopyLogs}
                                        className="gap-1"
                                    >
                                        {copied ? (
                                            <Check className="h-3 w-3" />
                                        ) : (
                                            <Copy className="h-3 w-3" />
                                        )}
                                        {copied ? "コピーしました" : "コピー"}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleClearLogs}
                                        className="gap-1 text-destructive hover:text-destructive"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                        ログを削除
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="text-xs text-muted-foreground">
                        <p>送信される情報：フィードバック内容、操作ログ、ブラウザ情報</p>
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2 shrink-0">
                    <Button
                        variant="outline"
                        onClick={() => setIsOpen(false)}
                    >
                        キャンセル
                    </Button>
                    <Button asChild className="gap-2">
                        <a href={generateMailtoLink()}>
                            <Mail className="h-4 w-4" />
                            メールで送信
                        </a>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
