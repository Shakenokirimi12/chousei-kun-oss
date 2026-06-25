import { ShiftAdminView } from "@/components/shift/ShiftAdminView";

export const metadata = {
    title: "シフト管理 - 調整くん",
};

export default async function ShiftAdminPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <ShiftAdminView boardId={id} />
        </div>
    );
}
