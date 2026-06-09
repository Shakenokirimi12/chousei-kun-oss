import { CUSTOM_PERIODS } from "@/config/periods";

type ICalEventOptions = {
    title: string;
    description?: string;
    startDateTime: Date;
    endDateTime: Date;
    location?: string;
};

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

function generateUID(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}@chousei-kun`;
}

function escapeICalText(text: string): string {
    return text
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\n/g, "\\n");
}

export function generateICalEvent(options: ICalEventOptions): string {
    const { title, description, startDateTime, endDateTime, location } = options;
    const now = new Date();

    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Chousei-kun//Schedule App//JA",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${generateUID()}`,
        `DTSTAMP:${formatICalDate(now)}`,
        `DTSTART:${formatICalDate(startDateTime)}`,
        `DTEND:${formatICalDate(endDateTime)}`,
        `SUMMARY:${escapeICalText(title)}`,
    ];

    if (description) {
        lines.push(`DESCRIPTION:${escapeICalText(description)}`);
    }

    if (location) {
        lines.push(`LOCATION:${escapeICalText(location)}`);
    }

    lines.push("END:VEVENT", "END:VCALENDAR");

    return lines.join("\r\n");
}

export function parseCandidateToDateTime(candidate: string): { start: Date; end: Date } | null {
    const [datePart, slotRaw] = candidate.split("_");
    if (!datePart || !slotRaw) return null;

    const slotType = slotRaw.charAt(0);
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

export function parseICal(icalData: string): { dtstart: string; dtend: string; summary: string }[] {
    const events: { dtstart: string; dtend: string; summary: string }[] = [];
    
    // Unfold lines: iCal lines starting with a space or tab are continuations
    const unfoldedData = icalData.replace(/\r?\n[ \t]/g, "");
    const lines = unfoldedData.split(/\r?\n/);
    
    let currentEvent: { dtstart?: string; dtend?: string; summary?: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "BEGIN:VEVENT") {
            currentEvent = {};
        } else if (line === "END:VEVENT") {
            if (currentEvent && currentEvent.dtstart && currentEvent.dtend) {
                events.push({
                    dtstart: currentEvent.dtstart,
                    dtend: currentEvent.dtend,
                    summary: currentEvent.summary || "(No Title)",
                });
            }
            currentEvent = null;
        } else if (currentEvent) {
            if (line.startsWith("DTSTART")) {
                currentEvent.dtstart = parseICalDateTime(line);
            } else if (line.startsWith("DTEND")) {
                currentEvent.dtend = parseICalDateTime(line);
            } else if (line.startsWith("SUMMARY")) {
                currentEvent.summary = parseICalTextValue(line);
            }
        }
    }

    return events;
}

function parseICalTextValue(line: string): string {
    const parts = line.split(":");
    if (parts.length < 2) return "";
    const value = parts.slice(1).join(":");
    return value
        .replace(/\\\\/g, "\\")
        .replace(/\\;/g, ";")
        .replace(/\\,/g, ",")
        .replace(/\\n/g, "\n");
}

/**
 * 指定タイムゾーンでの「naive な (Y,M,D,h,m,s)」を UTC instant (ms) に変換する。
 * Intl.DateTimeFormat の formatToParts を使い、対象 TZ における時計のオフセットを
 * 推定して補正する。Workers 環境でも Intl は利用可能。
 */
function localToUtcMs(timeZone: string, y: number, mo: number, d: number, h: number, mi: number, s: number): number {
    const utcMs = Date.UTC(y, mo - 1, d, h, mi, s);
    try {
        const dtf = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hourCycle: "h23",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        const parts = dtf.formatToParts(new Date(utcMs));
        const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? "0");
        const asUtcOfLocal = Date.UTC(
            get("year"),
            get("month") - 1,
            get("day"),
            get("hour"),
            get("minute"),
            get("second")
        );
        // utcMs を「ローカル時計」として読んだとき asUtcOfLocal になる →
        // 差分が当該 TZ の UTC からのオフセット
        const offsetMs = asUtcOfLocal - utcMs;
        return utcMs - offsetMs;
    } catch {
        // 未知の TZID は JST (+09:00) として扱う（このアプリは JST 中心）
        return utcMs - 9 * 60 * 60 * 1000;
    }
}

/**
 * iCal の DTSTART / DTEND 行を ISO 8601 文字列(UTC) に変換する。
 *
 * RFC 5545 に従い 3 形態をサポート:
 *   1. `DTSTART:20230517T100000Z`              → UTC
 *   2. `DTSTART;TZID=Asia/Tokyo:20230517T100000` → 指定 TZ のローカル時刻
 *   3. `DTSTART:20230517T100000`               → "floating time"。本アプリでは JST として解釈
 *
 * 旧実装はすべて UTC として扱っており、TZID 付き JST 13:00 が 22:00 にずれていた。
 */
function parseICalDateTime(line: string): string | undefined {
    // プロパティ部とパラメータ群を取り出す
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) return undefined;
    const propPart = line.slice(0, colonIdx); // 例: "DTSTART;TZID=Asia/Tokyo"
    const value = line.slice(colonIdx + 1);

    // TZID パラメータを抽出
    let tzid: string | undefined;
    const tzidMatch = propPart.match(/;TZID=([^;:]+)/i);
    if (tzidMatch) tzid = tzidMatch[1].replace(/^"|"$/g, "");

    // Format: YYYYMMDDTHHMMSS(Z)?
    const dateTimeMatch = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
    if (dateTimeMatch) {
        const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, zFlag] = dateTimeMatch;
        const y = Number(yearStr);
        const mo = Number(monthStr);
        const d = Number(dayStr);
        const h = Number(hourStr);
        const mi = Number(minuteStr);
        const s = Number(secondStr);

        if (zFlag) {
            // UTC 明示
            return new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toISOString();
        }
        if (tzid) {
            // TZID で指定されたローカル時刻
            // よくある日本系エイリアスを Asia/Tokyo に正規化
            let zone = tzid;
            if (/^(japan|asia\/tokyo|jst|tokyo)$/i.test(zone)) zone = "Asia/Tokyo";
            return new Date(localToUtcMs(zone, y, mo, d, h, mi, s)).toISOString();
        }
        // floating time。本アプリは JST 中心なので Asia/Tokyo として扱う
        return new Date(localToUtcMs("Asia/Tokyo", y, mo, d, h, mi, s)).toISOString();
    }

    // Format: YYYYMMDD (終日)
    const dateMatch = value.match(/^(\d{4})(\d{2})(\d{2})/);
    if (dateMatch) {
        const [, yearStr, monthStr, dayStr] = dateMatch;
        // 終日イベントの日付は TZ から独立。日付の 0:00 を JST として表す。
        const ms = localToUtcMs("Asia/Tokyo", Number(yearStr), Number(monthStr), Number(dayStr), 0, 0, 0);
        return new Date(ms).toISOString();
    }

    return undefined;
}

export function downloadICalFile(content: string, filename: string): void {
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
