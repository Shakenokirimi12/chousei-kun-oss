import { z } from "zod";

/**
 * 候補スロット文字列: `YYYY-MM-DD_P<n>` または `YYYY-MM-DD_H<n>`。
 * 形式に加えて日付が実在することを検証する。
 */
const candidateSchema = z
    .string()
    .max(32)
    .regex(/^\d{4}-\d{2}-\d{2}_(P|H)\d+$/)
    .refine((value) => {
        const [datePart] = value.split("_");
        const [y, m, d] = datePart.split("-").map(Number);
        if (m < 1 || m > 12 || d < 1 || d > 31) return false;
        const date = new Date(Date.UTC(y, m - 1, d));
        return (
            date.getUTCFullYear() === y &&
            date.getUTCMonth() === m - 1 &&
            date.getUTCDate() === d
        );
    }, "Invalid candidate date");

const candidatesSchema = z.array(candidateSchema).min(1).max(500);

export const createEventSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional().default(""),
    candidates: candidatesSchema,
    adminPassword: z.string().min(8).max(256),
    /** 任意: デバイス localStorage の userId。マイページ一覧で使う。 */
    creatorUserId: z.string().uuid().optional(),
});

export const eventIdParamSchema = z.object({
    id: z.string().uuid(),
});

export const ownParticipantParamSchema = z.object({
    id: z.string().uuid(),
    participantId: z.string().uuid(),
});

export const participateSchema = z.object({
    name: z.string().trim().min(1).max(100),
    comment: z.string().max(1000).optional().default(""),
    availabilities: z.array(z.number().int().min(0).max(2)).max(500),
    participantId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    notifyOnFinalize: z.boolean().optional().default(false),
    notificationEmail: z.string().email().max(254).optional().or(z.literal("")).default(""),
});

export const adminAuthSchema = z.object({
    password: z.string().min(1).max(256),
});

export const adminUpdateSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional().default(""),
    candidates: candidatesSchema,
});

export const confirmCandidateSchema = z.object({
    confirmedCandidateIdx: z.number().int().min(0).nullable(),
    skipCalendarInvite: z.boolean().optional().default(false),
});

export const addToCalendarSchema = z.object({
    confirmedCandidateIdx: z.number().int().min(0),
});

export const syncCalendarSchema = z.object({
    uid: z.string().min(1).max(128),
    pass: z.string().min(1).max(256),
});

export const syncICalSchema = z.object({
    url: z.string().url().max(2048),
});

export const updateNotificationSchema = z.object({
    participantId: z.string().uuid(),
    notifyOnFinalize: z.boolean(),
    notificationEmail: z.string().email().max(254).optional().or(z.literal("")).default(""),
});

export const googleStartQuerySchema = z.object({
    returnTo: z.string().max(512).optional().default("/"),
    userId: z.string().uuid().optional(),
});

// --- Office Hour ---

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HM_END_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

export const weeklyWindowSchema = z.object({
    day: z.number().int().min(0).max(6),
    start: z.string().regex(HM_RE),
    end: z.string().regex(HM_END_RE),
}).refine((w) => {
    const [sh, sm] = w.start.split(":").map(Number);
    const [eh, em] = w.end.split(":").map(Number);
    return eh * 60 + em > sh * 60 + sm;
}, "end must be after start");

export const createOfficeHourSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional().default(""),
    // 受付期間は任意。NULL の場合は startDate=今日 / endDate=無期限 として扱う。
    startDate: z.number().int().nullable().optional(),
    endDate: z.number().int().nullable().optional(),
    windows: z.array(weeklyWindowSchema).min(1).max(50),
    slotDurationMin: z.number().int().min(5).max(8 * 60),
    capacityPerSlot: z.number().int().min(1).max(100),
    bufferMin: z.number().int().min(0).max(120).optional().default(0),
    adminPassword: z.string().min(8).max(256),
    // 大学カレンダー(iCal URL)。必須。
    icalUrl: z.string().url().max(2048),
}).refine(
    (v) => v.startDate == null || v.endDate == null || v.endDate >= v.startDate,
    "endDate must be >= startDate"
);

export const officeHourIdParamSchema = z.object({
    id: z.string().uuid(),
});

export const updateOfficeHourSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    startDate: z.number().int().nullable().optional(),
    endDate: z.number().int().nullable().optional(),
    windows: z.array(weeklyWindowSchema).min(1).max(50).optional(),
    slotDurationMin: z.number().int().min(5).max(8 * 60).optional(),
    capacityPerSlot: z.number().int().min(1).max(100).optional(),
    bufferMin: z.number().int().min(0).max(120).optional(),
});

export const bookOfficeHourSchema = z.object({
    slotStart: z.number().int(),               // ms epoch
    name: z.string().trim().min(1).max(100),
    comment: z.string().max(1000).optional().default(""),
    email: z.string().email().max(254).optional().or(z.literal("")).default(""),
    userId: z.string().uuid().optional(),
});

// --- シフト調整 ---

/** 作成・編集時のシフト枠。id 付きは既存枠の更新、無しは新規作成として扱う。 */
const shiftSlotInputSchema = z.object({
    id: z.string().uuid().optional(),
    startsAt: z.number().int(),         // ms epoch
    endsAt: z.number().int(),           // ms epoch
    role: z.string().trim().min(1).max(100),
    place: z.string().trim().max(100).optional().default(""),
    capacity: z.number().int().min(1).max(1000),
    sortOrder: z.number().int().min(0).max(10000).optional().default(0),
}).refine((s) => s.endsAt > s.startsAt, "endsAt must be after startsAt");

export const createShiftBoardSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional().default(""),
    date: z.number().int(),             // 対象日 JST 0:00 ms
    submissionDeadline: z.number().int().nullable().optional(),
    slots: z.array(shiftSlotInputSchema).min(1).max(500),
    adminPassword: z.string().min(8).max(256),
    creatorUserId: z.string().uuid().optional(),
});

export const updateShiftBoardSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    date: z.number().int().optional(),
    submissionDeadline: z.number().int().nullable().optional(),
    slots: z.array(shiftSlotInputSchema).min(1).max(500).optional(),
});

export const shiftBoardIdParamSchema = z.object({
    id: z.string().uuid(),
});

export const ownShiftMemberParamSchema = z.object({
    id: z.string().uuid(),
    memberId: z.string().uuid(),
});

/** メンバーの NG 申告（出られない枠の id 配列）。userId で本人を識別し再提出を許す。 */
export const submitShiftMemberSchema = z.object({
    name: z.string().trim().min(1).max(100),
    comment: z.string().max(1000).optional().default(""),
    memberId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    unavailableSlotIds: z.array(z.string().uuid()).max(500).default([]),
});

/** 管理者による割当の一括置換。(slotId, memberId) のペア配列。 */
export const setShiftAssignmentsSchema = z.object({
    assignments: z
        .array(z.object({ slotId: z.string().uuid(), memberId: z.string().uuid() }))
        .max(5000),
});

export const publishShiftBoardSchema = z.object({
    published: z.boolean(),
});
