import { Hono } from "hono";
import { sValidator } from "@hono/standard-validator";
import { eventsRoutes, googleRoutes, usersRoutes, aiRoutes, officeHoursRoutes, adminRoutes } from "./routes";
import { syncCalendarSchema, syncICalSchema } from "./schemas";
import { CampusSquareService } from "@/lib/campus-square";
import { parseICal } from "@/lib/ical";
import { safeFetchText } from "@/lib/safe-fetch";

type Bindings = {
    DB: D1Database;
    OPENCODE_API_KEY: string;
};

export const apiApp = new Hono<{ Bindings: Bindings }>().basePath("/api");

apiApp.route("/events", eventsRoutes);
apiApp.route("/google", googleRoutes);
apiApp.route("/users", usersRoutes);
apiApp.route("/ai", aiRoutes);
apiApp.route("/office-hours", officeHoursRoutes);
apiApp.route("/admin", adminRoutes);

apiApp.post("/sync-calendar", sValidator("json", syncCalendarSchema), async (c) => {
    if (process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE !== "true") {
        return c.json({ error: "Campus Square integration is disabled." }, 404);
    }

    const { uid, pass } = c.req.valid("json");
    const result = await CampusSquareService.fetchCalendarWithUrl(uid, pass);
    return c.json({ events: result.events, icalUrl: result.icalUrl });
});

apiApp.post("/sync-ical", sValidator("json", syncICalSchema), async (c) => {
    const { url } = c.req.valid("json");
    try {
        const icalData = await safeFetchText(url);
        const events = parseICal(icalData);
        return c.json({ events });
    } catch (error) {
        console.error("[sync-ical]", error);
        return c.json({ error: "Failed to fetch or parse iCal URL" }, 400);
    }
});

apiApp.onError((error, c) => {
    console.error("[API Error]", error);
    return c.json({ error: "Internal Server Error" }, 500);
});
