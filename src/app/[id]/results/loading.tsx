import { Loader2 } from "lucide-react";

export default function Loading() {
    return (
        <div className="min-h-screen bg-background text-foreground px-3 sm:px-4 md:px-6 lg:px-8 pt-8 sm:pt-10 lg:pt-12 pb-24">
            <div className="w-full space-y-6">
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-md bg-muted animate-pulse" />
                    <div className="space-y-2">
                        <div className="h-6 w-32 rounded-md bg-muted animate-pulse" />
                        <div className="h-4 w-48 rounded-md bg-muted/70 animate-pulse" />
                    </div>
                </div>
                <div className="flex flex-col items-center justify-center gap-4 py-24" role="status" aria-live="polite">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <p className="text-muted-foreground font-medium text-sm">回答結果を読み込み中...</p>
                </div>
            </div>
        </div>
    );
}
