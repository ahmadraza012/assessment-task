# Softphone call panel

A small React + TypeScript panel driven by the provided mock telephony engine (`src/callEngine.ts`). The engine is **not modified**. Incoming calls, hold/mute, a second waiting call, and messy event delivery (late, duplicated, out of order) are all handled in the state layer.

## Run

```bash
npm install
npm run dev
```

Tests for the reducer:

```bash
npm test
```

## How state is modeled

Each call is its own lifecycle. Mute is a flag on that lifecycle, not a separate phase.

| Phase     | Meaning                                      |
| --------- | -------------------------------------------- |
| `idle`    | No live calls (panel-level, not a call)      |
| `incoming`| `INCOMING` / `RINGING`, not answered or ended |
| `active`  | Answered, not on hold                        |
| `held`    | Answered and currently held                  |
| `ended`   | `ENDED` has been applied                     |

**Why fold events per call instead of storing “current phase” on the last packet?** The engine stamps `at` when it *creates* an event, then delivers it later (sometimes twice). Arrival order is not engine order. The UI therefore never trusts wall-clock order.

For every `callId` we keep the unique events `(type, at)` and **recompute** the view by sorting on `at` and reducing:

1. `INCOMING` / `RINGING` → incoming (caller id can fill in late).
2. `ANSWERED` → active.
3. `HELD` / `RESUMED` toggle hold only while the call is still live.
4. `MUTED` / `UNMUTED` toggle mute independently of hold.
5. `ENDED` is **sticky**. After it appears in the ordered log, later `ANSWERED` / hold / mute events are ignored so hangup cannot be undone by a slower `answer()` timeout.

Displayed state always comes from this fold. Buttons only record an in-flight action so the agent sees “Answering…”; they do not change phase themselves.

## Out-of-order and duplicates

- **Dedup:** the engine re-fires the *same* event object. Key is `callId + type + at`. A second delivery is a no-op.
- **Late events:** because we sort by `at` then fold, a RINGING that arrives before INCOMING still becomes incoming with the right number once INCOMING is applied; an ANSWERED with an earlier `at` than ENDED cannot show the call as active.
- **Action races:** `answer` / `hangup` / hold / mute assign `at` when their timeout fires, not when the agent clicked. Preferring a sticky `ENDED` keeps the panel from resurrecting a call the agent already hung up.

Tombstones stay in the board so a duplicate `ENDED` or a late `RINGING` after hangup cannot open a new incoming row for that id.

## Concurrent calls

The engine can spawn a second incoming call while one is live. The panel lists incoming separately from the connected line. **Answer** on a waiting call calls `engine.hold` on the current active call, then `engine.answer` on the waiting one. **Decline** is `engine.hangup` on that waiting id. Hold / resume / mute always target a specific `callId`.

## Mock engine note

`start()` always schedules `ENDED` with reason `no_answer` several seconds after spawn, even if you already answered. That is engine behavior, not a UI bug: when that event is folded, the call ends.
