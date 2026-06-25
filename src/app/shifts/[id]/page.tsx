import { ShiftMemberView } from "@/components/shift/ShiftMemberView";

export default async function ShiftMemberPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <ShiftMemberView boardId={id} />
        </div>
    );
}
