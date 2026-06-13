import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
    return (
        <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-3xl font-bold">ページが見つかりません</h1>
            <p className="text-muted-foreground max-w-md">
                URL を直接入力された場合は綴りをご確認ください。古いリンクの可能性もあります。
                イベントの主催者から最新のリンクを受け取って再度アクセスしてください。
            </p>
            <div className="flex gap-2 flex-wrap justify-center">
                <Link href="/">
                    <Button>トップへ戻る</Button>
                </Link>
                <Link href="/create">
                    <Button variant="outline">新しい予定表を作成</Button>
                </Link>
            </div>
        </div>
    );
}
