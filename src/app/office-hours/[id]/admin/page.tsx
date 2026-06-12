import { OfficeHourAdminView } from "@/components/officeHour/OfficeHourAdminView";

export const metadata = {
    title: "Office Hour 管理 - 調整くん",
};

export default async function OfficeHourAdminPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <OfficeHourAdminView id={id} />
        </div>
    );
}
