import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createDb } from "@/server/db/client";
import { createEventService } from "@/server/services";
import { CUSTOM_PERIODS } from "@/config/periods";
import { nextDateString } from "@/lib/candidates";

function formatICalDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return (
        date.getUTCFullYear().toString() +
        pad(date.getUTCMonth() + 1) +
        pad(date.getUTCDate()) +
        "T" +
        pad(date.getUTCHours()) +
        pad(date.getUTCMinutes()) +
        pad(date.getUTCSeconds()) +
        "Z"
    );
}

function escapeICalText(text: string): string {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\n/g, "\\n");
}

type CandidateDateTime =
    | { allDay: true; date: string }
    | { allDay?: false; start: Date; end: Date };

function parseCandidateToDateTime(candidate: string): CandidateDateTime | null {
    const [datePart, slotRaw] = candidate.split("_");
    if (!datePart || !slotRaw) return null;

    const slotType = slotRaw.charAt(0);
    if (slotType === "D") {
        return { allDay: true, date: datePart };
    }

    const slotId = Number.parseInt(slotRaw.slice(1), 10);
    if (Number.isNaN(slotId)) return null;

    const baseDate = new Date(datePart);
    if (Number.isNaN(baseDate.getTime())) return null;

    let startHour = 0;
    let startMinute = 0;
    let endHour = 0;
    let endMinute = 0;

    if (slotType === "P") {
        const period = CUSTOM_PERIODS.find((p) => p.id === slotId);
        if (!period) return null;
        const [startHm, endHm] = period.time.split("-");
        [startHour, startMinute] = startHm.split(":").map(Number);
        [endHour, endMinute] = endHm.split(":").map(Number);
    } else if (slotType === "H") {
        startHour = Math.max(0, Math.min(23, slotId));
        endHour = Math.min(24, startHour + 1);
        startMinute = 0;
        endMinute = 0;
    } else {
        return null;
    }

    const start = new Date(baseDate);
    start.setHours(startHour, startMinute, 0, 0);

    const end = new Date(baseDate);
    end.setHours(endHour, endMinute, 0, 0);

    return { start, end };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const { env } = await getCloudflareContext();
    const db = createDb(env.DB);
    const eventService = createEventService(db);

    const event = await eventService.findByIdPublic(id);

    if (!event) {
        return new Response("Event not found", { status: 404 });
    }

    const now = new Date();
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Chousei-kun//Schedule App//JA",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:${escapeICalText(event.title)}`,
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ];

    if (event.confirmedCandidateIdx !== null) {
        const confirmedCandidate = event.candidates[event.confirmedCandidateIdx];
        if (confirmedCandidate) {
            const dateTime = parseCandidateToDateTime(confirmedCandidate);
            if (dateTime) {
                const dtLines = dateTime.allDay
                    ? [
                          `DTSTART;VALUE=DATE:${dateTime.date.replaceAll("-", "")}`,
                          `DTEND;VALUE=DATE:${nextDateString(dateTime.date).replaceAll("-", "")}`,
                      ]
                    : [
                          `DTSTART:${formatICalDate(dateTime.start)}`,
                          `DTEND:${formatICalDate(dateTime.end)}`,
                      ];
                lines.push(
                    "BEGIN:VEVENT",
                    `UID:${id}@chousei-kun`,
                    `DTSTAMP:${formatICalDate(now)}`,
                    ...dtLines,
                    `SUMMARY:${escapeICalText(event.title)}`,
                    `DESCRIPTION:${escapeICalText(event.description || "調整くんで確定した日程です。")}`,
                    "STATUS:CONFIRMED",
                    "END:VEVENT"
                );
            }
        }
    } else {
        lines.push(
            "BEGIN:VEVENT",
            `UID:${id}-pending@chousei-kun`,
            `DTSTAMP:${formatICalDate(now)}`,
            `DTSTART:${formatICalDate(now)}`,
            `DTEND:${formatICalDate(now)}`,
            `SUMMARY:${escapeICalText(`[未確定] ${event.title}`)}`,
            `DESCRIPTION:${escapeICalText("日程はまだ確定していません。確定後にカレンダーが更新されます。")}`,
            "STATUS:TENTATIVE",
            "END:VEVENT"
        );
    }

    lines.push("END:VCALENDAR");

    const icalContent = lines.join("\r\n");

    return new Response(icalContent, {
        status: 200,
        headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": `attachment; filename="${id}.ics"`,
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    });
}
