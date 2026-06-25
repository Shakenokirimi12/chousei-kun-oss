import { ShiftEditView } from "@/components/shift/ShiftEditView";

export const metadata = {
    title: "シフト表を編集 - 調整くん",
};

export default async function ShiftEditPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <ShiftEditView boardId={id} />
        </div>
    );
}
