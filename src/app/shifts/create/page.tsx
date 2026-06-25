import { ShiftCreateForm } from "@/components/shift/ShiftCreateForm";

export const metadata = {
    title: "シフト表を作成 - 調整くん",
};

export default function ShiftCreatePage() {
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <ShiftCreateForm />
        </div>
    );
}
