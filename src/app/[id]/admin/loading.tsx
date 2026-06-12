import { Loader2 } from "lucide-react";

export default function Loading() {
    return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
            <div className="flex flex-col items-center justify-center gap-4" role="status" aria-live="polite">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-muted-foreground font-medium text-sm">管理画面を読み込み中...</p>
            </div>
        </div>
    );
}
