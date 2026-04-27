import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { siteConfig } from "@/config/site";

const EventForm = dynamic(() => import('@/components/EventForm').then(mod => mod.EventForm), {
	loading: () => (
		<div className="flex justify-center items-center my-32 space-x-2">
			<Loader2 className="w-8 h-8 text-primary animate-spin" />
			<span className="text-muted-foreground font-medium">フォームを読み込み中...</span>
		</div>
	)
});

export default function CreateEventPage() {
	return (
		<div className="h-dvh overflow-hidden flex flex-col bg-background text-foreground p-2 sm:p-4 md:p-6 lg:p-8">
			<div className="mb-3 rounded-md border bg-card/40 p-3 text-sm">
				<p className="font-semibold">{siteConfig.name}</p>
				<p className="text-muted-foreground">
					{siteConfig.name} は、イベントの日程候補を作成し、参加者の出欠を集計して最適日程を決めるためのスケジュール調整アプリです。
				</p>
				<div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
					<Link href="/privacy" className="underline underline-offset-4">
						プライバシーポリシー
					</Link>
					<Link href="/tos" className="underline underline-offset-4">
						利用規約
					</Link>
				</div>
			</div>
			<EventForm />
		</div>
	);
}
