"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOM_PERIODS, HOURLY_SLOTS } from "./PeriodSelector";
import { AvailabilityTimeline } from "@/components/AvailabilityTimeline";
import { cn } from "@/lib/utils";
import { Check, X, Triangle, Circle, Loader2, Calendar as CalendarIcon } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import dynamic from "next/dynamic";
import { useUser } from "@/hooks/useUser";
import { logActivity } from "@/hooks/useActivityLog";

const AISchedulingAssistant = dynamic(() => import("@/components/AISchedulingAssistant"), { ssr: false });
const CalendarImportMenu = dynamic(() => import("@/components/CalendarImportMenu"), { ssr: false });

interface ResponseFormProps {
  eventId: string;
  candidates: string[];
  participants: { id: string; name: string; comment: string | null }[];
  allAvailabilities: { participantId: string; candidateIdx: number; status: number }[];
  onSuccess: () => Promise<void>;
}

export function ResponseForm({ eventId, candidates, participants, allAvailabilities, onSuccess }: ResponseFormProps) {
  const router = useRouter();
  const { userId } = useUser();
  const [name, setName] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [notifyOnFinalize, setNotifyOnFinalize] = React.useState(false);
  const [notificationEmail, setNotificationEmail] = React.useState("");
  const [showAllDayDialog, setShowAllDayDialog] = React.useState(false);
  const [pendingGoogleEvents, setPendingGoogleEvents] = React.useState<any[]>([]);
  const [pendingAllDayDates, setPendingAllDayDates] = React.useState<string[]>([]);
  const [availabilities, setAvailabilities] = React.useState<number[]>(
    new Array(candidates.length).fill(2), // Default to 'O'
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
  const EXCLUDED_ICAL_URLS = ["https://csweb.u-aizu.ac.jp/calendar/AcademicCalendar-student-E.ics", "https://csweb.u-aizu.ac.jp/calendar/AcademicCalendar-student-J.ics"];

  const isExcludedCalendarEvent = React.useCallback((event: any) => {
    const fieldsToCheck = [event?.sourceUrl, event?.icalUrl, event?.calendarUrl, event?.calendarId, event?.source, event?.description, event?.htmlLink].filter(Boolean).map((v: string) => String(v));

    return EXCLUDED_ICAL_URLS.some((url) => fieldsToCheck.some((value) => value.includes(url)));
  }, []);

  const isAllDayEvent = React.useCallback((event: any) => {
    if (event?.allDay === true) return true;
    const startRaw = event?.dtstart ?? event?.start;
    const endRaw = event?.dtend ?? event?.end;
    if (!startRaw || !endRaw) return false;

    // Typical all-day representation from Google/GAS:
    // start: "YYYY-MM-DD", end: "YYYY-MM-DD" (exclusive end)
    if (/^\d{4}-\d{2}-\d{2}$/.test(startRaw) && /^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
      return true;
    }
    return false;
  }, []);

  const parseCandidateForConflict = React.useCallback((candidate: string) => {
    const [datePart, slotId] = candidate.split("_");
    const date = new Date(datePart);

    let period = null;
    const type = slotId.charAt(0);
    const id = parseInt(slotId.substring(1));

    if (type === "P") {
      period = CUSTOM_PERIODS.find((p: any) => p.id === id);
    } else if (type === "H") {
      period = HOURLY_SLOTS.find((h) => h.id === id);
    } else {
      const pid = parseInt(slotId);
      period = CUSTOM_PERIODS.find((p: any) => p.id === pid);
    }

    return { date, period };
  }, []);

  const parseDateOnly = React.useCallback((raw: unknown) => {
    const text = String(raw ?? "");
    if (!text) return null;

    // "YYYY-MM-DD" の場合はローカル日付として扱う
    const dateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
      const [, y, m, d] = dateMatch;
      return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
  }, []);

  const applyGoogleConflicts = React.useCallback(
    (events: any[], applyAllDay: boolean, detectedEmail?: string) => {
      setAvailabilities((prevAvailabilities) => {
        const nextAvailabilities = [...prevAvailabilities];
        let conflictCount = 0;

        candidates.forEach((candidate, idx) => {
          const { date: cDate, period: cPeriod } = parseCandidateForConflict(candidate);
          if (!cPeriod) return;

          const [startH, startM] = cPeriod.time.split("-")[0].split(":").map(Number);
          const [endH, endM] = cPeriod.time.split("-")[1].split(":").map(Number);

          const cStart = new Date(cDate);
          cStart.setHours(startH, startM, 0, 0);
          const cEnd = new Date(cDate);
          cEnd.setHours(endH, endM, 0, 0);

          const candidateDay = new Date(cDate);
          candidateDay.setHours(0, 0, 0, 0);

          const hasConflict = events.some((ev: any) => {
            if (isAllDayEvent(ev)) {
              if (!applyAllDay) return false;
              const startRaw = ev.dtstart ?? ev.start;
              const endRaw = ev.dtend ?? ev.end;
              const startDay = parseDateOnly(startRaw);
              let endDay = parseDateOnly(endRaw); // exclusive end
              if (!startDay) return false;

              // まれに end が欠落/同日になる予定があるため、最低1日分は反映する
              if (!endDay || endDay <= startDay) {
                endDay = new Date(startDay);
                endDay.setDate(startDay.getDate() + 1);
              }
              return candidateDay >= startDay && candidateDay < endDay;
            }

            const eStart = new Date(ev.dtstart || ev.start);
            const eEnd = new Date(ev.dtend || ev.end);
            return cStart < eEnd && cEnd > eStart;
          });

          if (hasConflict) {
            nextAvailabilities[idx] = 0; // Mark as X
            conflictCount++;
          }
        });

        setFeedback({
          title: "Googleカレンダー連携成功",
          message: `${conflictCount}件の重複スロットを自動的に「×」に設定しました。`,
          isOpen: true,
        });

        return nextAvailabilities;
      });
    },
    [candidates, parseCandidateForConflict, isAllDayEvent, parseDateOnly],
  );

  const hasAllDayOverlapWithCandidates = React.useCallback(
    (event: any) => {
      const startRaw = event?.dtstart ?? event?.start;
      const endRaw = event?.dtend ?? event?.end;
      const startDay = parseDateOnly(startRaw);
      let endDay = parseDateOnly(endRaw); // exclusive end
      if (!startDay) return false;
      if (!endDay || endDay <= startDay) {
        endDay = new Date(startDay);
        endDay.setDate(startDay.getDate() + 1);
      }

      return candidates.some((candidate) => {
        const { date } = parseCandidateForConflict(candidate);
        const candidateDay = new Date(date);
        candidateDay.setHours(0, 0, 0, 0);
        return candidateDay >= startDay && candidateDay < endDay;
      });
    },
    [candidates, parseCandidateForConflict, parseDateOnly],
  );

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

    setParticipantId(storedId);
    setName(existingParticipant.name);
    setComment(existingParticipant.comment || "");

    // Reconstruct availabilities from the (PII-free) availability list
    const myAvails = allAvailabilities.filter((a) => a.participantId === storedId);
    const newAvails = new Array(candidates.length).fill(2); // Default to O
    myAvails.forEach((a) => {
      if (a.candidateIdx < newAvails.length) {
        newAvails[a.candidateIdx] = a.status;
      }
    });
    setAvailabilities(newAvails);

    // Fetch the participant's OWN notification settings (not exposed in the public list).
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/participant/${storedId}`);
        if (!res.ok || cancelled) return;
        const own = (await res.json()) as { notifyOnFinalize?: number; notificationEmail?: string | null };
        if (cancelled) return;
        setNotifyOnFinalize((own.notifyOnFinalize ?? 0) === 1);
        setNotificationEmail(own.notificationEmail || "");
      } catch {
        // 通知設定の取得失敗は致命的ではない（既定値のまま）。
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, participants, allAvailabilities, candidates.length]);

  // Helper to parse candidate string "YYYY-MM-DD_P#" or legacy "YYYY-MM-DD_H#"
  const parseCandidate = React.useCallback((candidate: string) => {
    const [datePart, slotId] = candidate.split("_");
    const date = new Date(datePart);

    let period = null;
    const type = slotId.charAt(0);
    const id = parseInt(slotId.substring(1));

    if (type === "P") {
      period = CUSTOM_PERIODS.find((p: any) => p.id === id);
    } else if (type === "H") {
      period = HOURLY_SLOTS.find((h) => h.id === id);
    } else {
      // Fallback for old data (assuming it was a period ID directly)
      const pid = parseInt(slotId);
      period = CUSTOM_PERIODS.find((p: any) => p.id === pid);
    }

    return { date, period };
  }, []);

  const [busyEvents, setBusyEvents] = React.useState<{ start: string; end: string; summary: string }[]>([]);

  const mapEventsToPeriods = React.useCallback((events: any[]) => {
    const newBusyPeriods: string[] = [];

    events.forEach((event) => {
      const startDate = new Date(event.dtstart || event.start);
      const endDate = new Date(event.dtend || event.end);
      const dateStr = startDate.toISOString().split("T")[0];

      const checkOverlap = (startA: Date, endA: Date, startB: Date, endB: Date) => {
        return startA < endB && endA > startB;
      };

      CUSTOM_PERIODS.forEach((p: any) => {
        const [startH, startM] = p.time.split("-")[0].split(":").map(Number);
        const [endH, endM] = p.time.split("-")[1].split(":").map(Number);

        const pStart = new Date(startDate);
        pStart.setHours(startH, startM, 0, 0);
        const pEnd = new Date(startDate);
        pEnd.setHours(endH, endM, 0, 0);

        if (checkOverlap(startDate, endDate, pStart, pEnd)) {
          newBusyPeriods.push(`${dateStr}_P${p.id}`);
        }
      });

      HOURLY_SLOTS.forEach((h) => {
        const [startH] = h.time.split("-")[0].split(":").map(Number);
        const pStart = new Date(startDate);
        pStart.setHours(startH, 0, 0, 0);
        const pEnd = new Date(startDate);
        pEnd.setHours(startH + 1, 0, 0, 0);

        if (checkOverlap(startDate, endDate, pStart, pEnd)) {
          newBusyPeriods.push(`${dateStr}_H${h.id}`);
        }
      });
    });
    return [...new Set(newBusyPeriods)];
  }, []);

  const busyPeriodIds = React.useMemo(() => {
    return mapEventsToPeriods(busyEvents);
  }, [busyEvents, mapEventsToPeriods]);

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

      const data = (await res.json()) as { events: { dtstart: string; dtend: string }[] };
      applyImportedEvents(data.events);
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

      const data = (await res.json()) as { events: { dtstart: string; dtend: string }[] };
      applyImportedEvents(data.events);
    } catch (e: any) {
      setFeedback({
        title: "エラー",
        message: e.message || "インポートに失敗しました",
        isOpen: true,
      });
    } finally {
      setIsCampusImporting(false);
    }
  };

  const applyImportedEvents = (events: { dtstart: string; dtend: string; summary?: string }[]) => {
    // Populate busy events for display
    const newEvents = events.map(ev => ({
        start: ev.dtstart,
        end: ev.dtend,
        summary: ev.summary || "予定あり"
    }));

    setBusyEvents((prev) => {
      const next = [...prev];
      newEvents.forEach((ne) => {
        if (!next.some((p) => p.start === ne.start && p.end === ne.end && p.summary === ne.summary)) {
          next.push(ne);
        }
      });
      return next;
    });

    // Conflict Detection
    const newAvailabilities = [...availabilities];
    let conflictCount = 0;

    candidates.forEach((candidate, idx) => {
      const { date, period } = parseCandidate(candidate);
      if (!period) return;

      const [startH, startM] = period.time.split("-")[0].split(":").map(Number);
      const [endH, endM] = period.time.split("-")[1].split(":").map(Number);
      const dateOnly = new Date(date);
      dateOnly.setHours(0, 0, 0, 0);

      const cStart = new Date(dateOnly);
      cStart.setHours(startH, startM, 0, 0);
      const cEnd = new Date(dateOnly);
      cEnd.setHours(endH, endM, 0, 0);

      // Check against each imported event
      const hasConflict = events.some((ev) => {
        const eStart = new Date(ev.dtstart);
        const eEnd = new Date(ev.dtend);
        return cStart < eEnd && cEnd > eStart;
      });

      if (hasConflict) {
        newAvailabilities[idx] = 0; // Mark as X
        conflictCount++;
      }
    });

    setAvailabilities(newAvailabilities);

    if (conflictCount > 0) {
      setFeedback({
        title: "インポート成功",
        message: `スケジュールをインポートしました。${conflictCount}件の重複スロットを「×」に設定しました。`,
        isOpen: true,
      });
    } else {
      setFeedback({
        title: "インポート成功",
        message: "スケジュールをインポートしました。候補日程との重複はありませんでした。",
        isOpen: true,
      });
    }
  };

  const handleGoogleImport = async () => {
    setIsGoogleImporting(true);
    try {
      const res = await fetch("/api/google/calendar/events");
      if (res.status === 401) {
        const url = new URL(window.location.href);
        url.searchParams.set("googleOAuth", "1");
        const returnTo = encodeURIComponent(url.pathname + url.search);
        window.location.href = `/api/google/auth/start?returnTo=${returnTo}`;
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
        events: any[];
      };
      const events = (googleData.events || []).filter((ev: any) => !isExcludedCalendarEvent(ev));
      const detectedEmail = googleData.email || "";

      // Populate busy events for display
      const newEvents = events.map(ev => ({
          start: ev.dtstart,
          end: ev.dtend,
          summary: ev.summary || "予定あり"
      }));

      setBusyEvents((prev) => {
        const next = [...prev];
        newEvents.forEach((ne) => {
          if (!next.some((p) => p.start === ne.start && p.end === ne.end && p.summary === ne.summary)) {
            next.push(ne);
          }
        });
        return next;
      });

      if (detectedEmail) {
        setNotificationEmail(detectedEmail);
        setNotifyOnFinalize(true);
      }

      const allDayEvents = events.filter((ev: any) => isAllDayEvent(ev) && hasAllDayOverlapWithCandidates(ev));
      if (allDayEvents.length > 0) {
        const allDayDates = Array.from(new Set(allDayEvents.map((ev: any) => String(ev.dtstart || ev.start))));
        setPendingGoogleEvents(events);
        setPendingAllDayDates(allDayDates as string[]);
        setShowAllDayDialog(true);
        return;
      }

      applyGoogleConflicts(events, false, detectedEmail);
    } finally {
      setIsGoogleImporting(false);
    }
  };

  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("googleOAuth") !== "1") return;

    handleGoogleImport().finally(() => {
      url.searchParams.delete("googleOAuth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    });
  }, []);

  const handleStatusChange = (idx: number, status: number) => {
    setAvailabilities((prev) => {
      const next = [...prev];
      next[idx] = status;
      return next;
    });
  };

  const getStatusIcon = (status: number) => {
    switch (status) {
      case 0:
        return <X className="w-6 h-6 text-red-500" />;
      case 1:
        return <Triangle className="w-6 h-6 text-yellow-500" />;
      case 2:
        return <Circle className="w-6 h-6 text-green-500" />;
      default:
        return null;
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = notificationEmail.trim();
    const isEditing = Boolean(participantId);
    if (!trimmedName) return;

    // メール通知を希望する場合のクライアント側バリデーション
    if (notifyOnFinalize && !trimmedEmail) {
      setFeedback({
        title: "メールアドレスが必要です",
        message: "通知を受け取るにはメールアドレスを入力してください。",
        isOpen: true,
      });
      return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFeedback({
        title: "メールアドレスの形式が正しくありません",
        message: "正しい形式のメールアドレスを入力してください。",
        isOpen: true,
      });
      return;
    }

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
          notifyOnFinalize: notifyOnFinalize,
          notificationEmail: trimmedEmail,
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
    } catch (err: any) {
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

  const [isAIPaneOpen, setIsAIPaneOpen] = React.useState(false);

  return (
    <div className="w-full mt-6 animate-in fade-in slide-in-from-bottom-4 duration-700 flex overflow-hidden min-h-[600px]">
      <div className={cn("flex-1 flex flex-col min-w-0 px-0 sm:px-2 lg:px-4 overflow-y-auto transition-all duration-300", isAIPaneOpen ? "lg:mr-0" : "")}>
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
              <label htmlFor="participant-name" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">お名前</label>
              <Input id="participant-name" placeholder="名前を入力してください" value={name} onChange={(e) => setName(e.target.value)} required aria-required="true" maxLength={100} className="bg-background/50 backdrop-blur-sm" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="participant-comment" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">コメント (任意)</label>
              <Input id="participant-comment" placeholder="メッセージがあれば入力してください" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} className="bg-background/50 backdrop-blur-sm" />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium leading-none">出欠を選択 <span className="text-muted-foreground font-normal">(カレンダー内をタップして切り替え)</span></label>
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
            </div>
            <AvailabilityTimeline
              candidates={candidates}
              availabilities={availabilities}
              onStatusChange={handleStatusChange}
              onDayStatusChange={handleDayStatusChange}
              busyEvents={busyEvents}
              okCounts={okCounts}
            />
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-center py-2">
              <div className="flex items-center gap-1.5">
                <Circle className="w-3 h-3 text-green-500" /> 参加可能
              </div>
              <div className="flex items-center gap-1.5">
                <Triangle className="w-3 h-3 text-yellow-500" /> 調整中
              </div>
              <div className="flex items-center gap-1.5">
                <X className="w-3 h-3 text-red-500" /> 不参加
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <Button className="shadow-lg shadow-primary/20 min-w-40" size="lg" onClick={handleSubmit} disabled={!name.trim() || isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {participantId ? "回答を更新" : "回答を送信"}
            </Button>
          </div>
        </div>
      </div>

      <AISchedulingAssistant
        mode="respond"
        candidates={candidates}
        currentSchedule={candidates.map((c, i) => `${c}:${availabilities[i]}`)}
        onChange={(updated) => {
          const newAvails = [...availabilities];
          updated.forEach((item) => {
            const [candidate, status] = item.split(":");
            const idx = candidates.indexOf(candidate);
            if (idx !== -1) {
              const s = parseInt(status);
              if (!isNaN(s)) newAvails[idx] = s;
            }
          });
          setAvailabilities(newAvails);
        }}
        isOpen={isAIPaneOpen}
        onOpen={() => setIsAIPaneOpen(true)}
        onClose={() => setIsAIPaneOpen(false)}
      />

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

      <Dialog open={showAllDayDialog} onOpenChange={setShowAllDayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>終日予定が見つかりました</DialogTitle>
            <DialogDescription>
              終日予定がある日: {pendingAllDayDates.join(", ")}
              <br />
              これらの日は候補をすべて「×」にしますか？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAllDayDialog(false);
                applyGoogleConflicts(pendingGoogleEvents, false);
                setPendingGoogleEvents([]);
                setPendingAllDayDates([]);
              }}
            >
              終日予定は無視する
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowAllDayDialog(false);
                applyGoogleConflicts(pendingGoogleEvents, true);
                setPendingGoogleEvents([]);
                setPendingAllDayDates([]);
              }}
            >
              該当日はすべて「×」にする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
