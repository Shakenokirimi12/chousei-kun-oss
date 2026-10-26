"use client";

import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/useCopy";

/**
 * コマンドや URL をそのまま貼れるように見せるブロック。
 * スマホでは横スクロールに気付きにくいため、途中で折り返して全体を見せる。
 */
export function CopyableCode({ children }: { children: string }) {
    const { copy, copied, error } = useCopy();
    return (
        <div className="space-y-2">
            <pre className="rounded-md bg-muted p-4 text-xs leading-6 whitespace-pre-wrap break-all">
                <code>{children}</code>
            </pre>
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void copy(children)}>
                {copied ? <Check className="h-4 w-4" /> : error ? <X className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "コピーしました" : error ? "コピーできませんでした" : "コピー"}
            </Button>
        </div>
    );
}
