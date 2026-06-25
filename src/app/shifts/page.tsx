import { ShiftListView } from "@/components/shift/ShiftListView";

export const metadata = {
    title: "シフト調整 - 調整くん",
};

export default function ShiftsPage() {
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <ShiftListView />
        </div>
    );
}
