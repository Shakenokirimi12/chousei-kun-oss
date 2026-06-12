import { OfficeHourListView } from "@/components/officeHour/OfficeHourListView";

export const metadata = {
    title: "Office Hour 一覧 - 調整くん",
};

export default function OfficeHoursPage() {
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <OfficeHourListView />
        </div>
    );
}
