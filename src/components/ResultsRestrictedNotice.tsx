"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
    eventId: string;
    /** true なら pid クエリで既に本人特定を試みて失敗した状態（再チェック不要） */
    alreadyAttempted: boolean;
};

export function ResultsRestrictedNotice({ eventId, alreadyAttempted }: Props) {
    const router = useRouter();
    const [checking, setChecking] = useState(!alreadyAttempted);

    useEffect(() => {
        if (alreadyAttempted) return;
        const storedId = localStorage.getItem(`chosei_participant_${eventId}`);
        if (storedId) {
            router.replace(`/${eventId}/results?pid=${storedId}`);
            return;
        }
        setChecking(false);
    }, [eventId, alreadyAttempted, router]);

    if (checking) return null;

    return (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
            <Lock className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="font-medium">この回答結果は非公開に設定されています</p>
            <p className="text-sm text-muted-foreground">
                回答済みの方は、ご自身が回答した端末からアクセスすると自分の回答内容を確認できます。
            </p>
            <Link href={`/${eventId}`}>
                <Button size="sm">回答画面へ</Button>
            </Link>
        </div>
    );
}
