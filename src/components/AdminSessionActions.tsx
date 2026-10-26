"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
    eventId: string;
};

export function AdminSessionActions({ eventId }: Props) {
    const router = useRouter();

    const logout = async () => {
        await fetch(`/api/events/${eventId}/admin-logout`, { method: "POST" });
        router.replace(`/${eventId}/admin/login`);
        router.refresh();
    };

    return (
        <Button type="button" variant="outline" onClick={logout}>
            管理画面からログアウト
        </Button>
    );
}
