import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2 } from "lucide-react";

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
		<div className="h-dvh overflow-hidden flex flex-col bg-background text-foreground px-3 sm:px-4 md:px-6 lg:px-8 pt-6 sm:pt-8 pb-2 sm:pb-4">
			<EventForm />
			<div className="mt-3 shrink-0 rounded-md border bg-card/40 p-3 text-sm">
				<div className="flex flex-wrap items-center gap-4 text-sm">
					<Link href="/privacy" className="underline underline-offset-4 text-muted-foreground hover:text-foreground">
						プライバシーポリシー
					</Link>
					<Link href="/tos" className="underline underline-offset-4 text-muted-foreground hover:text-foreground">
						利用規約
					</Link>
				</div>
			</div>
		</div>
	);
}
