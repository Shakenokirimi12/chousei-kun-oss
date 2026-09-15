---
name: chousei-kun
description: Create and manage 調整くん (chousei-kun) scheduling events through its remote MCP server — create events, check responses, register participants, and run admin operations (confirm a date, duplicate, export CSV, toggle results visibility). Use when the user wants to set up an event to coordinate a date/time with other people, check who has responded, or manage an event they created.
---

# chousei-kun (調整くん)

調整くん is a scheduling-coordination app: you propose candidate dates/times,
share a link, and participants mark each candidate ○ (ok) / △ (maybe) / ×
(no). This skill drives it through its MCP server so you can create and
manage events on the user's behalf without leaving the conversation.

## Before you start

This skill requires the `chousei-kun` MCP server to be connected (its tools
are named `create_event`, `get_event`, `list_my_events`,
`participate_in_event`, `admin_confirm_candidate`, `admin_duplicate_event`,
`admin_export_csv`, `admin_update_results_visibility`). If those tools are not
available, tell the user to connect the MCP server for their chousei-kun
deployment (`<their-app-url>/api/mcp`) and stop — do not try to call the REST
API directly instead.

There is no separate login. Two identifiers matter, and you should keep track
of them for the user across a conversation instead of asking twice:

- **`creatorUserId`** — a random UUID identifying "this person's events" on
  `list_my_events`. If the user hasn't given you one, generate a fresh UUID
  once and remember it for the rest of the session; mention it so they can
  reuse it later ("save this to see your events again: ...").
- **`adminPassword`** — set per-event at creation time, required for every
  `admin_*` tool on that event. It is not recoverable, so if the user loses
  it, the only option is `admin_duplicate_event` from a session that still
  has it, or creating a new event.

**Never log, echo back unnecessarily, or store `adminPassword` outside of the
current tool call.** Treat it like any other secret the user hands you.

## Candidate date format

Candidates are strings, one of:

- `YYYY-MM-DD_D` — all-day (a single calendar date, for "which days work")
- `YYYY-MM-DD_Hn` — a fixed hour slot, e.g. `2026-04-10_H14` for 14:00 on 2026-04-10
- `YYYY-MM-DD_Pn` — a school "period" slot (n = period number)

An event's candidates must be **all one kind** — don't mix `_D` with
`_H`/`_P` in the same `create_event` call. Ask the user whether they're
picking whole days or specific time slots if it's not obvious, and generate
the candidate list from whatever dates/times they describe in natural
language (e.g. "next Tue/Wed/Thu afternoon" → resolve actual calendar dates
first).

## Typical flows

**Create an event and share it:**
1. Confirm title, candidate dates, and get (or generate) an admin password —
   8+ characters. If the user doesn't care, generate a random one and give it
   to them; don't make one up without telling them what it is.
2. Call `create_event` with `title`, `candidates`, `adminPassword`, and
   `creatorUserId` if you have one for this user.
3. Share the returned `url` with the user. That's the link participants use.

**Check who has responded:**
- Call `get_event` with the `eventId` (parse it out of a shared URL if that's
  what the user pasted). If the event has `resultsVisible: false`, results
  are hidden and you need the event's `adminPassword` to see them — ask for it
  rather than assuming you can bypass it.

**Register a response on someone's behalf:**
- Call `participate_in_event` with `eventId`, `name`, and `availabilities` (an
  array aligned index-for-index with the event's `candidates`, using
  `0` = ×, `1` = △, `2` = ○). Get the event's `candidates` via `get_event`
  first if you don't already know the order.

**Finalize a date:**
- Call `admin_confirm_candidate` with the `adminPassword` and the index (into
  `candidates`) of the chosen date. Pass `null` to un-confirm.

**List "my events":**
- Call `list_my_events` with the `creatorUserId` you've been using for this
  user.

## Guardrails

- Admin tools (`admin_*`) always require the correct `adminPassword` for that
  specific event — never guess or reuse a password from a different event.
- `admin_update_results_visibility` can only set `resultsVisibleToAll: false`
  on all-day (`_D`) events; timed events always show results to everyone.
  If the tool returns an error about this, explain the constraint rather than
  retrying.
- If a tool call returns `isError: true`, surface the error message to the
  user plainly (e.g. "invalid password", "event not found") instead of
  guessing what went wrong.
