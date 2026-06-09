import { OfficeHourBookingView } from "@/components/officeHour/OfficeHourBookingView";

export default async function OfficeHourBookingPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return (
        <div className="min-h-screen bg-background text-foreground pb-24">
            <OfficeHourBookingView id={id} />
        </div>
    );
}
