import { OfficeHourCreateForm } from "@/components/officeHour/OfficeHourCreateForm";

export const metadata = {
    title: "Office Hour を作成 - 調整くん",
};

export default function OfficeHourCreatePage() {
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <OfficeHourCreateForm />
        </div>
    );
}
