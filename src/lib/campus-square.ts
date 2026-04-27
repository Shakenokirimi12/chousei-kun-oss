export interface CalendarEvent {
    uid: string;
    summary: string;
    dtstart: Date;
    dtend: Date;
    location?: string;
    description?: string;
    rrule?: string;
}

export class CampusSquareService {
    private static UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

    private static getPortalUrl(): string {
        const url = process.env.CAMPUS_SQUARE_BASE_URL;
        if (!url) {
            throw new Error("Campus Square連携が設定されていません。");
        }

        // Accept both:
        // - https://example.ac.jp
        // - https://example.ac.jp/campusweb
        const normalized = url.replace(/\/$/, "");
        return normalized.endsWith("/campusweb") ? normalized : `${normalized}/campusweb`;
    }

    private static getOrigin(portalUrl: string): string {
        return new URL(portalUrl).origin;
    }

    // Helper to extract JSESSIONID from raw headers
    private static getJSessionId(headers: Headers): string | null {
        // Cloudflare Workers/Node fetch might return set-cookie as a comma separated string or we use getSetCookie() if available.
        // Safe approach: try get('set-cookie') and Regex.
        const setCookie = headers.get('set-cookie');
        if (!setCookie) return null;
        const match = setCookie.match(/JSESSIONID=([A-Z0-9]+)/);
        return match ? match[1] : null;
    }

    static async fetchCalendarEvents(uid: string, pass: string): Promise<CalendarEvent[]> {
        let lastSid = "None"; // For debugging context if needed

        try {
            console.log('[CampusSquareService] Starting Sync Process');
            console.log('[CampusSquareService] STEP 1: Landing on portal');

            // STEP 1: Landing
            const portalUrl = this.getPortalUrl();
            const origin = this.getOrigin(portalUrl);

            const res1 = await fetch(`${portalUrl}/campusportal.do?locale=ja_JP`, {
                headers: { 'User-Agent': this.UA },
            });
            console.log('[CampusSquareService] res1 ok:', res1.ok, 'status:', res1.status);

            const buf1 = await res1.arrayBuffer();
            console.log('[CampusSquareService] buf1 length:', buf1.byteLength);

            const decoder = new TextDecoder("shift_jis");
            console.log('[CampusSquareService] decoder created');

            const text1 = decoder.decode(buf1);
            console.log('[CampusSquareService] text1 decoded, length:', text1.length);

            const rwfHash = text1.match(/'rwfHash'\s*:\s*'([a-f0-9]+)'/)?.[1] || "";
            const initialSid = this.getJSessionId(res1.headers) || "";
            console.log('[CampusSquareService] rwfHash:', rwfHash, 'initialSid:', initialSid);
            lastSid = initialSid;

            if (!rwfHash) {
                console.error("[CampusSquareService] rwfHash not found. HTML snippet:", text1.substring(0, 500));
                throw new Error("rwfHashが見つかりませんでした。");
            }


            // STEP 2: Login POST
            const loginWfId = process.env.CAMPUS_SQUARE_LOGIN_WFID;
            if (!loginWfId) throw new Error("Campus Square Login WFID is not configured");

            const postBody = `wfId=${loginWfId}&userName=${encodeURIComponent(uid)}&password=${encodeURIComponent(pass)}&locale=ja_JP&undefined=&action=rwf&tabId=home&page=&rwfHash=${rwfHash}`;
            const res2 = await fetch(`${portalUrl}/campusportal.do`, {
                method: 'POST',
                body: postBody,
                headers: {
                    'User-Agent': this.UA,
                    'Cookie': `JSESSIONID=${initialSid}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `${portalUrl}/campusportal.do?locale=ja_JP`,
                    'Origin': origin
                },
            });

            // Update SID if changed (usually it is rotated after login)
            const authenticatedSid = this.getJSessionId(res2.headers) || initialSid;
            lastSid = authenticatedSid;

            // STEP 3: Main page (Check login success)
            const res3 = await fetch(`${portalUrl}/campusportal.do?page=main`, {
                headers: {
                    'User-Agent': this.UA,
                    'Cookie': `JSESSIONID=${authenticatedSid}`,
                    'Referer': `${portalUrl}/campusportal.do`
                },
            });
            const buf3 = await res3.arrayBuffer();
            const mainHtml = decoder.decode(buf3);

            if (!mainHtml.includes('ログアウト') && !mainHtml.includes('Logout')) {
                // Try to capture error message from page
                const errorMatch = mainHtml.match(/<span[^>]*class="error"[^>]*>(.*?)<\/span>/i);
                if (errorMatch) {
                    throw new Error(`Login failed: ${errorMatch[1].trim()}`);
                }
                console.error("[CampusSquareService] Login check failed. SID Used:", authenticatedSid);
                throw new Error("ログインに失敗しました。学籍番号またはパスワードを確認してください。");
            }

            // STEP 3.5: Tab Bridge
            await fetch(`${portalUrl}/campusportal.do?page=main&tabId=po`, {
                headers: {
                    'User-Agent': this.UA,
                    'Cookie': `JSESSIONID=${authenticatedSid}`,
                    'Referer': `${portalUrl}/campusportal.do?page=main`
                },
            });
            // Small delay just in case (though unnecessary in pure async fetch usually, mimicking behavior)
            await new Promise(r => setTimeout(r, 300));

            // STEP 4: Calendar Page
            const calendarFlowId = process.env.CAMPUS_SQUARE_CALENDAR_FLOWID;
            if (!calendarFlowId) throw new Error("Campus Square Calendar FlowID is not configured");

            const res4 = await fetch(`${portalUrl}/campussquare.do?_flowId=${calendarFlowId}`, {
                headers: {
                    'User-Agent': this.UA,
                    'Cookie': `JSESSIONID=${authenticatedSid}`,
                    'Referer': `${portalUrl}/campusportal.do?page=main&tabId=po`,
                },
            });

            const buf4 = await res4.arrayBuffer();
            const calendarHtml = decoder.decode(buf4);

            const calendarUrlMatch = calendarHtml.match(/id="calendarNm"[^>]*value="([^"]+)"/i);
            const calendarUrl = calendarUrlMatch?.[1] || "";

            if (!calendarUrl) {
                console.error("[CampusSquareService] Calendar URL not found in HTML.");
                throw new Error("カレンダーのURLが見つかりませんでした。");
            }

            // Fetch ICS
            console.log('[CampusSquareService] Fetching ICS from:', calendarUrl);
            const icsRes = await fetch(calendarUrl, {
                headers: { 'User-Agent': this.UA }
            });

            if (!icsRes.ok) throw new Error(`カレンダーデータの取得に失敗しました (ステータス: ${icsRes.status})`);
            // ICS is usually UTF-8 or compatible ASCII, but let's be safe
            const icsText = await icsRes.text();

            return this.parseICS(icsText);

        } catch (error) {
            console.error('[CampusSquareService] Error:', error);
            throw error;
        }
    }

    private static parseICS(icsText: string): CalendarEvent[] {
        const events: CalendarEvent[] = [];
        const eventBlocks = icsText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];

        eventBlocks.forEach(block => {
            try {
                const getField = (name: string): string => {
                    const regex = new RegExp(`^${name}[;:](.*)`, 'im');
                    const match = block.match(regex);
                    return match ? match[1].replace(/\\n/g, '\n').replace(/\\,/g, ',').trim() : '';
                };

                const uid = getField('UID');
                const summary = getField('SUMMARY');
                const dtstartRaw = getField('DTSTART');
                const dtendRaw = getField('DTEND');

                const parseICSDate = (raw: string): Date => {
                    const cleaned = raw.replace(/^[^:]*:/, '');
                    const match = cleaned.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
                    if (match) {
                        const [, y, m, d, h = '0', min = '0', s = '0'] = match;
                        // Treatment as specified timezone offset
                        const tzOffset = process.env.CAMPUS_SQUARE_TIMEZONE_OFFSET;
                        if (!tzOffset) throw new Error("Timezone offset not configured");

                        return new Date(`${y}-${m}-${d}T${h.padStart(2, '0')}:${min.padStart(2, '0')}:${s.padStart(2, '0')}${tzOffset}`);
                    }
                    return new Date(raw);
                };


                if (summary && dtstartRaw) {
                    // Skip if Summary indicates it's likely not a class? 
                    // Usually we want everything. User can filter.
                    // Clean summary (remove extra spaces)
                    const cleanSummary = summary.replace(/\\/g, '');

                    events.push({
                        uid: uid || `event-${events.length}`,
                        summary: cleanSummary,
                        dtstart: parseICSDate(dtstartRaw),
                        dtend: dtendRaw ? parseICSDate(dtendRaw) : parseICSDate(dtstartRaw),
                    });
                }
            } catch (e) {
                console.warn('Failed to parse VEVENT:', e);
            }
        });

        return events;
    }
}
