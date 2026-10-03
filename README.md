# Softphone call panel

A **Next.js** (App Router) + TypeScript panel driven by the provided mock telephony engine (`src/callEngine.ts`). The engine is **not modified**. Incoming calls, hold/mute, a second waiting call, and messy event delivery (late, duplicated, out of order) are handled in the state layer.

## Run

```
npm install
npm run dev
```


## How state is modeled

Each **spawn** is its own lifecycle, keyed by `instanceId`, not by the engine's `callId`. Mute is a flag on that lifecycle, not a separate phase.

| Phase      | Meaning                                       |
| ---------- | --------------------------------------------- |
| `idle`     | No live calls (panel-level, not a call)       |
| `incoming` | `INCOMING` / `RINGING`, not answered or ended |
| `active`   | The single talking line                       |
| `held`     | Answered and not the talking line             |
| `ended`    | `ENDED` has been applied                      |

Events are stored per instance, sorted by `at`, and folded. Displayed phase always comes from that fold, then **one talking line**: if the engine has two `ANSWERED` calls before `HELD` arrives, only the call the agent last answered or resumed is shown as Active.

## Exclusive line (one Active call)

Answer and Resume always `hold()` every other live call that is already Active, or that we have already asked to Answer (two ringing calls). Resume holds the current Active call first. The panel also projects non-talking `active` peers as `held` so the UI cannot show two Active cards while hold events are still in flight.

## Reused engine call ids

The mock draws `callId` from ~9,000 values and will eventually reuse them. A new `INCOMING`/`RINGING` for an id that already has a live or ended spawn becomes a new `instanceId`. Late `INCOMING` is still paired with the same spawn when its `at` is before that spawn's `RINGING`. Engine methods still receive the raw `callId`.

## Out-of-order and duplicates

- **Dedup:** `callId + type + at`. A second delivery of the same object is a no-op.
- **UI:** the right-hand **Event log** tags those deliveries as **Duplicate ignored** so you can see the call already had that state.
- **Late events:** sort by `at` then fold. Sticky `ENDED` (`hangup`) so a slower `answer()` timeout cannot resurrect a hung-up call.

Each card shows ringing / talk time **once per second** (not a fast tick). The mock’s spawn schedule is unchanged — we do not edit `callEngine.ts`.

## Typecheck vs `callEngine.ts`

`src/callEngine.ts` uses `Omit<CallEvent, 'at'>` on a union. That type does not keep `from` / `reason`, so **tsc reports 3 errors inside the provided file**. We do not edit it.

- `tsconfig.json` **excludes** `src/callEngine.ts`.
- TypeScript imports `@engine` from `src/callEngine.d.ts` (hand-written types).
- Next.js webpack/turbopack alias `@engine` to the real `src/callEngine.ts` at bundle time.

`npm run typecheck` and `npm run build` therefore type-check our code without compiling the engine's broken `emit` helper.

## Concurrent calls

Incoming is listed separately from the connected line. Decline is `hangup` on that spawn's engine id.

## Mock engine note

`start()` still emits `ENDED` / `no_answer` a few seconds after spawn, even after Answer. The panel **drops** that timeout once you have answered (or clicked Answer), so the call stays on the line. Decline and Hang up still end it.
