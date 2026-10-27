"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOM_PERIODS, HOURLY_SLOTS } from "./PeriodSelector";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";
import { DailyAvailabilityList } from "@/components/DailyAvailabilityList";
import { isAllDayEvent as areAllDayCandidates, isAllDayCandidate, UNANSWERED } from "@/lib/candidates";
import { allDayEventCovers, expandAllDayToBlocks, normalizeAllDayEvent, type AllDayEventRange } from "@/lib/allDayEvents";
import { AllDayEventChoiceDialog } from "@/components/AllDayEventChoiceDialog";
import { format } from "date-fns";
import { X, Triangle, Circle, Loader2 } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import dynamic from "next/dynamic";
import { useUser } from "@/hooks/useUser";
import { logActivity } from "@/hooks/useActivityLog";

const CalendarImportMenu = dynamic(() => import("@/components/CalendarImportMenu"), { ssr: false });

interface ResponseFormProps {
  eventId: string;
  candidates: string[];
  participants: { id: string; name: string; comment: string | null }[];
  allAvailabilities: { participantId: string; candidateIdx: number; status: number }[];
  onSuccess: () => Promise<void>;
}

/** Google/大学カレンダー/iCal から取り込んだ、生の予定データの緩い共通形 */
interface RawImportedEvent {
  dtstart?: string;
  start?: string;
  dtend?: string;
  end?: string;
  summary?: string;
  allDay?: boolean;
  sourceUrl?: string;
  icalUrl?: string;
  calendarUrl?: string;
  calendarId?: string;
  source?: string;
  description?: string;
  htmlLink?: string;
}

const EXCLUDED_ICAL_URLS = ["https://csweb.u-aizu.ac.jp/calendar/AcademicCalendar-student-E.ics", "https://csweb.u-aizu.ac.jp/calendar/AcademicCalendar-student-J.ics"];

function isAllDayRawEvent(event: RawImportedEvent): boolean {
  if (event.allDay === true) return true;
  const startRaw = event.dtstart ?? event.start;
  const endRaw = event.dtend ?? event.end;
  if (!startRaw || !endRaw) return false;
  // Typical all-day representation from Google/GAS:
  // start: "YYYY-MM-DD", end: "YYYY-MM-DD" (exclusive end)
  return /^\d{4}-\d{2}-\d{2}$/.test(startRaw) && /^\d{4}-\d{2}-\d{2}$/.test(endRaw);
}

type BusyEvent = { start: string; end: string; summary: string; source: string; allDay: boolean };

function isSameAllDayEvent(a: AllDayEventRange, b: AllDayEventRange): boolean {
  return a.start === b.start && a.end === b.end && a.summary === b.summary;
}

export function ResponseForm({ eventId, candidates, participants, allAvailabilities, onSuccess }: ResponseFormProps) {
  const router = useRouter();
  // 「日毎の出欠確認」イベント（全候補が終日形式）かどうか
  const isDailyEvent = React.useMemo(() => areAllDayCandidates(candidates), [candidates]);
  const { userId } = useUser();
  const [name, setName] = React.useState("");
  const [comment, setComment] = React.useState("");
  // All-day events found on an import wait here until the user picks which to reflect.
  // Queued per import, so a second import finishing while the dialog is open waits its turn.
  const [allDayChoices, setAllDayChoices] = React.useState<{
    key: number;
    events: AllDayEventRange[];
    timed: BusyEvent[];
    source: string;
  }[]>([]);
  const allDayChoiceKeyRef = React.useRef(0);
  // Events waiting in the queue. An identical event (same dates and name) from a concurrent
  // import is not asked again, even from another calendar: the choice is about the event itself.
  const queuedAllDayRef = React.useRef<AllDayEventRange[]>([]);
  // 未回答(-1)で始める。○で始めると、スマホで画面外にある候補を見ないまま送ったときに
  // 「全部参加できる」と集計されてしまう。未回答が残っている間は送信できない。
  const [availabilities, setAvailabilities] = React.useState<number[]>(
    new Array(candidates.length).fill(UNANSWERED),
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isCampusImporting, setIsCampusImporting] = React.useState(false);
  const [isGoogleImporting, setIsGoogleImporting] = React.useState(false);
  const [participantId, setParticipantId] = React.useState<string | null>(null);

  // Import Dialog State
  const ENABLE_CAMPUS_SQUARE = process.env.NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE === "true";

  const [feedback, setFeedback] = React.useState<{ title: string; message: string; isOpen: boolean }>({
    title: "",
    message: "",
    isOpen: false,
  });

  const closeFeedback = () => setFeedback((prev) => ({ ...prev, isOpen: false }));

  const isExcludedCalendarEvent = React.useCallback((event: RawImportedEvent) => {
    const fieldsToCheck = [event?.sourceUrl, event?.icalUrl, event?.calendarUrl, event?.calendarId, event?.source, event?.description, event?.htmlLink].filter(Boolean).map((v) => String(v));

    return EXCLUDED_ICAL_URLS.some((url) => fieldsToCheck.some((value) => value.includes(url)));
  }, []);


  // Calculate aggregated OK counts for each candidate slot
  const okCounts = React.useMemo(() => {
    const counts = new Array(candidates.length).fill(0);
    allAvailabilities.forEach((a) => {
      if (a.candidateIdx < candidates.length && a.status === 2) {
        counts[a.candidateIdx]++;
      }
    });
    return counts;
  }, [allAvailabilities, candidates.length]);

  // Bulk actions
  const unansweredCount = availabilities.filter((s) => s === UNANSWERED).length;
  const fillUnanswered = (status: number) => {
    setAvailabilities((prev) => prev.map((s) => (s === UNANSWERED ? status : s)));
  };

  const setAllStatus = (status: number) => {
    setAvailabilities(new Array(candidates.length).fill(status));
  };

  const handleDayStatusChange = (dateStr: string, status: number) => {
    setAvailabilities((prev) => {
      const next = [...prev];
      candidates.forEach((c, idx) => {
        if (c.startsWith(dateStr)) {
          next[idx] = status;
        }
      });
      return next;
    });
  };

  // 既存の回答を編集状態で読み込む。通知設定は完了画面で扱うので、ここでは読まない。
  const loadParticipant = React.useCallback((id: string, existingParticipant: { name: string; comment?: string | null }) => {
    setParticipantId(id);
    setName(existingParticipant.name);
    setComment(existingParticipant.comment || "");

    // Reconstruct availabilities from the (PII-free) availability list
    const myAvails = allAvailabilities.filter((a) => a.participantId === id);
    // 回答後に追加された候補は未回答として扱う
    const newAvails = new Array(candidates.length).fill(UNANSWERED);
    myAvails.forEach((a) => {
      if (a.candidateIdx < newAvails.length) {
        newAvails[a.candidateIdx] = a.status;
      }
    });
    setAvailabilities(newAvails);
  }, [allAvailabilities, candidates.length]);

  // Load existing participant from localStorage
  React.useEffect(() => {
    const storedId = localStorage.getItem(`chosei_participant_${eventId}`);
    if (!storedId) return;

    const existingParticipant = participants.find((p) => p.id === storedId);
    if (!existingParticipant) {
      // Stored ID not found in server data (maybe deleted), clear it
      localStorage.removeItem(`chosei_participant_${eventId}`);
      return;
    }
    loadParticipant(storedId, existingParticipant);
  }, [eventId, participants, loadParticipant]);

  // 別の端末やブラウザから回答し直すと localStorage に手がかりが無く、新しい回答が増えてしまう。
  // 入力した名前が既存の回答と一致したら注意を出す。名前の一致だけで編集を許すと、
  // 名字が重なった別人の回答や通知先を書き換えられてしまうので、編集の入口にはしない。
  const sameNameParticipant = React.useMemo(() => {
    if (participantId) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
    return participants.find((p) => p.name.trim() === trimmed) ?? null;
  }, [participantId, name, participants]);

  // Helper to parse candidate string "YYYY-MM-DD_P#" or legacy "YYYY-MM-DD_H#"
  const parseCandidate = React.useCallback((candidate: string) => {
    const [datePart, slotId] = candidate.split("_");
    const date = new Date(datePart);

    let period = null;
    const type = slotId.charAt(0);
    const id = parseInt(slotId.substring(1));

    if (type === "P") {
      period = CUSTOM_PERIODS.find((p) => p.id === id);
    } else if (type === "H") {
      period = HOURLY_SLOTS.find((h) => h.id === id);
    } else {
      // Fallback for old data (assuming it was a period ID directly)
      const pid = parseInt(slotId);
      period = CUSTOM_PERIODS.find((p) => p.id === pid);
    }

    return { date, period };
  }, []);

  // source: 終日モードで「この日を×にした予定」を由来のカレンダーごとに表示するためのラベル
  // All-day entries hold JST "YYYY-MM-DD" dates (end exclusive), as DailyAvailabilityList expects.
  const [busyEvents, setBusyEvents] = React.useState<BusyEvent[]>([]);
  // The timeline places events by clock time, so all-day entries become full-day blocks.
  const timelineBusyEvents = React.useMemo(
    () => busyEvents.flatMap((ev) => (ev.allDay ? expandAllDayToBlocks(ev).map((block) => ({ ...ev, ...block })) : [ev])),
    [busyEvents],
  );

  const handleCampusSquareImport = async (uid: string, pass: string) => {
    if (!ENABLE_CAMPUS_SQUARE) return;
    setIsCampusImporting(true);
    try {
      const res = await fetch("/api/sync-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, pass }),
      });

      if (!res.ok) {
        const error = (await res.json()) as { error: string };
        throw new Error(error.error || "インポートに失敗しました");
      }

      const data = (await res.json()) as { events: { dtstart: string; dtend: string; summary?: string; allDay?: boolean }[] };
      applyImportedEvents(data.events, "大学カレンダー");
    } finally {
      setIsCampusImporting(false);
    }
  };

  const handleICalImport = async (url: string) => {
    setIsCampusImporting(true);
    try {
      const res = await fetch("/api/sync-ical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const error = (await res.json()) as { error: string };
        throw new Error(error.error || "インポートに失敗しました");
      }

      const data = (await res.json()) as { events: { dtstart: string; dtend: string; summary?: string; allDay?: boolean }[] };
      applyImportedEvents(data.events, "iCal");
    } catch (e) {
      setFeedback({
        title: "エラー",
        message: e instanceof Error ? e.message : "インポートに失敗しました",
        isOpen: true,
      });
    } finally {
      setIsCampusImporting(false);
    }
  };

  /** Reflects timed events plus the chosen all-day events, marking overlapping candidates as ×. */
  const reflectImportedEvents = (timed: BusyEvent[], allDay: AllDayEventRange[], source: string) => {
    // Only candidate days are shown, so record one day per covered candidate date instead of
    // the whole span. A long event over far-apart candidates would otherwise be expanded day by day.
    const candidateDates = Array.from(new Set(candidates.map((c) => c.split("_")[0])));
    const allDayBusy: BusyEvent[] = allDay.flatMap((ev) =>
      candidateDates
        .filter((d) => allDayEventCovers(ev, d))
        .map((d) => {
          const next = new Date(`${d}T00:00:00`);
          next.setDate(next.getDate() + 1);
          return { start: d, end: format(next, "yyyy-MM-dd"), summary: ev.summary, source, allDay: true };
        }),
    );
    setBusyEvents((prev) => {
      const next = [...prev];
      [...timed, ...allDayBusy].forEach((ne) => {
        if (!next.some((p) => p.start === ne.start && p.end === ne.end && p.summary === ne.summary && p.source === ne.source)) {
          next.push(ne);
        }
      });
      return next;
    });

    const conflicting = new Set<number>();
    candidates.forEach((candidate, idx) => {
      const dateStr = candidate.split("_")[0];
      const onBusyDay = allDay.some((ev) => allDayEventCovers(ev, dateStr));
      let hasConflict: boolean;
      if (isAllDayCandidate(candidate)) {
        // 終日候補: 終日予定と重なる日だけ×にする。
        // 時間指定の予定は自動×にしない（その日にいるか、の判断は回答者に委ねる）。
        hasConflict = onBusyDay;
      } else {
        const { period } = parseCandidate(candidate);
        if (!period) return;
        const [startH, startM] = period.time.split("-")[0].split(":").map(Number);
        const [endH, endM] = period.time.split("-")[1].split(":").map(Number);
        const cStart = new Date(`${dateStr}T00:00:00`);
        cStart.setHours(startH, startM, 0, 0);
        const cEnd = new Date(`${dateStr}T00:00:00`);
        cEnd.setHours(endH, endM, 0, 0);
        hasConflict = onBusyDay || timed.some((ev) => cStart < new Date(ev.end) && cEnd > new Date(ev.start));
      }
      if (hasConflict) conflicting.add(idx);
    });
    // Functional update: the Google import resumed after OAuth runs from a stale closure,
    // and answers may change while a fetch is in flight.
    setAvailabilities((prev) => prev.map((value, idx) => (conflicting.has(idx) ? 0 : value)));
    const conflictCount = conflicting.size;

    setFeedback({
      title: "インポート成功",
      message: conflictCount > 0
        ? `スケジュールをインポートしました。${conflictCount}件の重複スロットを「×」に設定しました。`
        : "スケジュールをインポートしました。候補日程との重複はありませんでした。",
      isOpen: true,
    });
  };

  const applyImportedEvents = (events: RawImportedEvent[], source: string) => {
    const timed: BusyEvent[] = events
      .filter((ev) => !isAllDayRawEvent(ev))
      .map((ev) => ({
        start: ev.dtstart || ev.start || "",
        end: ev.dtend || ev.end || "",
        summary: ev.summary || "予定あり",
        source,
        allDay: false,
      }));

    // Holidays and reminders are usually all-day events, so ask which ones to reflect.
    // Only events on a candidate day matter here.
    const candidateDates = Array.from(new Set(candidates.map((c) => c.split("_")[0])));
    const allDay = events
      .filter(isAllDayRawEvent)
      .map((ev) => normalizeAllDayEvent(ev.dtstart ?? ev.start, ev.dtend ?? ev.end, ev.summary || "予定あり"))
      .filter((ev): ev is AllDayEventRange => ev !== null && candidateDates.some((d) => allDayEventCovers(ev, d)))
      .filter((ev, i, arr) => arr.findIndex((o) => isSameAllDayEvent(o, ev)) === i)
      .filter((ev) => !queuedAllDayRef.current.some((q) => isSameAllDayEvent(q, ev)))
      .sort((a, b) => a.start.localeCompare(b.start));

    if (allDay.length > 0) {
      const key = ++allDayChoiceKeyRef.current;
      queuedAllDayRef.current = [...queuedAllDayRef.current, ...allDay];
      setAllDayChoices((prev) => [...prev, { key, events: allDay, timed, source }]);
      return;
    }
    reflectImportedEvents(timed, [], source);
  };

  const handleGoogleImport = async () => {
    setIsGoogleImporting(true);
    try {
      const res = await fetch("/api/google/calendar/events");
      if (res.status === 401) {
        const url = new URL(window.location.href);
        url.searchParams.set("googleOAuth", "1");
        const returnTo = encodeURIComponent(url.pathname + url.search);
        // 自分の予定プレビューのみ使うため read スコープに留める
        window.location.href = `/api/google/auth/start?returnTo=${returnTo}&scope=read`;
        return;
      }
      if (!res.ok) {
        setFeedback({
          title: "連携エラー",
          message: "Googleカレンダーの取得に失敗しました。",
          isOpen: true,
        });
        return;
      }

      const googleData = (await res.json()) as {
        email?: string;
        events: RawImportedEvent[];
      };
      const events = (googleData.events || []).filter((ev) => !isExcludedCalendarEvent(ev));
      applyImportedEvents(events, "Googleカレンダー");
    } finally {
      setIsGoogleImporting(false);
    }
  };

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("googleOAuth") !== "1") return;

    handleGoogleImport().finally(() => {
      // eslint-disable-next-line drizzle/enforce-delete-with-where -- URLSearchParams.delete(), not a DB query
      url.searchParams.delete("googleOAuth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    });
    // handleGoogleImport intentionally excluded: this must run once on mount only,
    // to consume the OAuth-return query param exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStatusChange = (idx: number, status: number) => {
    setAvailabilities((prev) => {
      const next = [...prev];
      next[idx] = status;
      return next;
    });
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const isEditing = Boolean(participantId);
    if (!trimmedName || unansweredCount > 0) return;

    logActivity(isEditing ? "回答更新開始" : "回答送信開始", `イベント: ${eventId}`);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/participate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          comment,
          availabilities,
          participantId: participantId || undefined,
          userId: userId || undefined,
          // 通知の設定は回答完了画面で行う。省略すると、更新時は保存済みの設定がそのまま残る。
        }),
      });

      if (!res.ok) {
        logActivity(isEditing ? "回答更新失敗" : "回答送信失敗", `ステータス: ${res.status}`);
        throw new Error("送信に失敗しました");
      }

      const data = (await res.json()) as { participantId: string };
      if (data.participantId) {
        localStorage.setItem(`chosei_participant_${eventId}`, data.participantId);
      }

      logActivity(isEditing ? "回答更新成功" : "回答送信成功", `イベント: ${eventId}`);
      await onSuccess();

      if (isEditing) {
        setFeedback({
          title: "成功",
          message: "回答を更新しました！",
          isOpen: true,
        });
        router.refresh();
      } else {
        router.push(`/${eventId}/complete`);
      }
    } catch (err) {
      console.error(err);
      setFeedback({
        title: "エラー",
        message: "回答の送信に失敗しました。もう一度お試しください。",
        isOpen: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <div className="w-full mt-6 animate-in fade-in slide-in-from-bottom-4 duration-700 flex overflow-hidden min-h-[600px]">
      <div className="flex-1 flex flex-col min-w-0 px-0 sm:px-2 lg:px-4 overflow-y-auto">
        <div className="mb-6">
          <h3 className="text-2xl font-bold">{participantId ? siteConfig.ui.responseEvent.titleEdit : siteConfig.ui.responseEvent.titleNew}</h3>
          <p className="text-muted-foreground mt-0.5">{participantId ? siteConfig.ui.responseEvent.descriptionEdit : siteConfig.ui.responseEvent.descriptionNew}</p>
          {(isCampusImporting || isGoogleImporting) && (
            <p className="text-sm text-muted-foreground mt-2">カレンダーを読み込み中です...</p>
          )}
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
            <div className="space-y-1.5">
              <label htmlFor="participant-name" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">お名前 <span className="text-xs font-normal text-red-600">必須</span></label>
              <Input id="participant-name" placeholder="名前を入力してください" value={name} onChange={(e) => setName(e.target.value)} required aria-required="true" maxLength={100} className="bg-background/50 backdrop-blur-sm" />
              {sameNameParticipant ? (
                <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
                  「{sameNameParticipant.name}」さんの回答がすでにあります。自分の回答を直すときは、前に回答した端末とブラウザでこのページを開いてください。別の人なら、区別できる名前にしてください。
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="participant-comment" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">コメント (任意)</label>
              <Input id="participant-comment" placeholder="メッセージがあれば入力してください" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} className="bg-background/50 backdrop-blur-sm" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium leading-none">出欠を選択 <span className="text-muted-foreground font-normal">{isDailyEvent ? "(日ごとに ○/△/× を選択)" : "(カレンダー内をタップして切り替え)"}</span></label>
              <CalendarImportMenu
                triggerLabel="自分の予定から取り込む"
                title="自分の予定から出欠を自動入力"
                description="取り込んだ予定と重なる時間は自動で「×」に設定されます。"
                enableCampusSquare={ENABLE_CAMPUS_SQUARE}
                onGoogleImport={handleGoogleImport}
                onGoogleImportLoading={isGoogleImporting}
                onCampusImport={handleCampusSquareImport}
                onICalImport={handleICalImport}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => setAllStatus(2)} className="bg-green-500/5 hover:bg-green-500/10 text-green-600 border-green-200">
                <Circle className="w-3 h-3 mr-1" /> 全て○にする
              </Button>
              <Button variant="outline" size="sm" type="button" onClick={() => setAllStatus(0)} className="bg-red-500/5 hover:bg-red-500/10 text-red-600 border-red-200">
                <X className="w-3 h-3 mr-1" /> 全て×にする
              </Button>
              {/* 予定の取り込みで×が入った後など、一部だけ回答済みのときに残りをまとめて埋める */}
              {unansweredCount > 0 && unansweredCount < candidates.length ? (
                <>
                  <Button variant="outline" size="sm" type="button" onClick={() => fillUnanswered(2)}>
                    <Circle className="w-3 h-3 mr-1" /> 未回答を○にする
                  </Button>
                  <Button variant="outline" size="sm" type="button" onClick={() => fillUnanswered(0)}>
                    <X className="w-3 h-3 mr-1" /> 未回答を×にする
                  </Button>
                </>
              ) : null}
            </div>
            {isDailyEvent ? (
              <DailyAvailabilityList
                candidates={candidates}
                availabilities={availabilities}
                onStatusChange={handleStatusChange}
                busyEvents={busyEvents}
                okCounts={okCounts}
              />
            ) : (
              <AvailabilityTimeline
                candidates={candidates}
                availabilities={availabilities}
                onStatusChange={handleStatusChange}
                onDayStatusChange={handleDayStatusChange}
                busyEvents={timelineBusyEvents}
                okCounts={okCounts}
              />
            )}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-center py-2">
              <div className="flex items-center gap-1.5">
                <Circle className="w-3 h-3 text-green-500" /> {isDailyEvent ? "いる" : "参加可能"}
              </div>
              <div className="flex items-center gap-1.5">
                <Triangle className="w-3 h-3 text-yellow-500" /> 未定
              </div>
              <div className="flex items-center gap-1.5">
                <X className="w-3 h-3 text-red-500" /> {isDailyEvent ? "いない" : "参加不可"}
              </div>
            </div>
          </div>

          <div className="pt-4 flex flex-col items-end gap-2">
            {!name.trim() || unansweredCount > 0 ? (
              <p className="text-sm text-muted-foreground text-right" role="status">
                {!name.trim() ? "お名前を入力すると送信できます。" : `未回答の候補が ${unansweredCount} 件あります。すべてに○△×を付けると送信できます。`}
              </p>
            ) : null}
            <Button className="shadow-lg shadow-primary/20 min-w-40" size="lg" onClick={handleSubmit} disabled={!name.trim() || unansweredCount > 0 || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {participantId ? "回答を更新" : "回答を送信"}
            </Button>
          </div>
        </div>
      </div>

      {/* Feedback Dialog */}
      <Dialog open={feedback.isOpen} onOpenChange={closeFeedback}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{feedback.title}</DialogTitle>
            <DialogDescription>{feedback.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={closeFeedback}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {allDayChoices[0] && (
        <AllDayEventChoiceDialog
          key={allDayChoices[0].key}
          events={allDayChoices[0].events}
          description="チェックした予定の日は、候補をすべて「×」にします。祝日など、参加に関係ない予定はチェックしないでください。"
          onDone={(chosen) => {
            const { events, timed, source } = allDayChoices[0];
            queuedAllDayRef.current = queuedAllDayRef.current.filter((q) => !events.includes(q));
            setAllDayChoices((prev) => prev.slice(1));
            reflectImportedEvents(timed, chosen, source);
          }}
        />
      )}
    </div>
  );
}
