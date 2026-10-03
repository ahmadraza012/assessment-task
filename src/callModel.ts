import type { CallEvent } from '@engine';

/** Lifecycle the panel renders. Mute is orthogonal and stored separately. */
export type CallPhase = 'incoming' | 'active' | 'held' | 'ended';

export type CallView = {
  /** Stable id for this spawn — engine `callId` values are reused. */
  instanceId: string;
  engineCallId: string;
  from: string;
  phase: CallPhase;
  muted: boolean;
  endedReason?: string;
  lastAt: number;
};

type CallRecord = {
  instanceId: string;
  engineCallId: string;
  events: CallEvent[];
  seen: Set<string>;
  view: CallView;
};

export type CallBoard = {
  calls: Record<string, CallRecord>;
  byEngineId: Record<string, string[]>;
  seen: Set<string>;
  gen: number;
};

export type ActionPendings = {
  answer: Set<string>;
  hangup: Set<string>;
  hold: Set<string>;
  resume: Set<string>;
  mute: Set<string>;
  unmute: Set<string>;
};

export function emptyPendings(): ActionPendings {
  return {
    answer: new Set(),
    hangup: new Set(),
    hold: new Set(),
    resume: new Set(),
    mute: new Set(),
    unmute: new Set(),
  };
}

const eventKey = (e: CallEvent) => `${e.callId}:${e.type}:${e.at}`;

function instanceHas(record: CallRecord, type: CallEvent['type']) {
  return record.events.some((event) => event.type === type);
}

function endedAt(record: CallRecord): number | undefined {
  return record.events.find((event) => event.type === 'ENDED')?.at;
}

function firstAt(record: CallRecord): number {
  return Math.min(...record.events.map((event) => event.at));
}

function foldCall(instanceId: string, engineCallId: string, events: CallEvent[]): CallView {
  const ordered = [...events].sort((a, b) => a.at - b.at || a.type.localeCompare(b.type));

  let from = 'Unknown';
  let answered = false;
  let ended = false;
  let endedReason: string | undefined;
  let held = false;
  let muted = false;
  let lastAt = 0;

  for (const event of ordered) {
    lastAt = Math.max(lastAt, event.at);

    if (ended) {
      continue;
    }

    switch (event.type) {
      case 'INCOMING':
        from = event.from;
        break;
      case 'RINGING':
        break;
      case 'ANSWERED':
        answered = true;
        break;
      case 'HELD':
        held = true;
        break;
      case 'RESUMED':
        held = false;
        break;
      case 'MUTED':
        muted = true;
        break;
      case 'UNMUTED':
        muted = false;
        break;
      case 'ENDED':
        ended = true;
        endedReason = event.reason;
        break;
    }
  }

  let phase: CallPhase;
  if (ended) phase = 'ended';
  else if (answered && held) phase = 'held';
  else if (answered) phase = 'active';
  else phase = 'incoming';

  return { instanceId, engineCallId, from, phase, muted, endedReason, lastAt };
}

function recordsFor(board: CallBoard, engineCallId: string): CallRecord[] {
  return (board.byEngineId[engineCallId] ?? [])
    .map((id) => board.calls[id])
    .filter(Boolean);
}

/** Pair INCOMING/RINGING onto the same spawn; a reused engine id starts a new instance. */
function pickStartInstance(records: CallRecord[], event: CallEvent): string | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i];
    const dead = rec.view.phase === 'ended' ? endedAt(rec) : undefined;

    if (event.type === 'INCOMING') {
      if (instanceHas(rec, 'INCOMING')) continue;
      if (instanceHas(rec, 'RINGING')) {
        const ringingAt = rec.events.find((e) => e.type === 'RINGING')!.at;
        if (event.at <= ringingAt && (dead === undefined || event.at <= dead)) {
          return rec.instanceId;
        }
        continue;
      }
      if (dead === undefined || event.at <= dead) {
        return rec.instanceId;
      }
    }

    if (event.type === 'RINGING') {
      if (instanceHas(rec, 'RINGING')) continue;
      if (instanceHas(rec, 'INCOMING')) {
        const incomingAt = rec.events.find((e) => e.type === 'INCOMING')!.at;
        if (event.at >= incomingAt && (dead === undefined || event.at <= dead)) {
          return rec.instanceId;
        }
        continue;
      }
      if (dead === undefined || event.at <= dead) {
        return rec.instanceId;
      }
    }
  }
  return null;
}

function lastPending(records: CallRecord[], pending: Set<string>): string | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    if (pending.has(records[i].instanceId)) return records[i].instanceId;
  }
  return undefined;
}

function pickLifecycleInstance(
  records: CallRecord[],
  event: CallEvent,
  pending: ActionPendings,
): string | null {
  if (records.length === 0) return null;

  if (event.type === 'ENDED') {
    const hung = lastPending(records, pending.hangup);
    if (hung) return hung;

    const live = records.filter((r) => r.view.phase !== 'ended');
    if (live.length === 1) return live[0].instanceId;
    if (live.length > 1) {
      let best = live[0];
      let bestScore = Infinity;
      for (const rec of live) {
        const dt = event.at - firstAt(rec);
        const inWindow = dt >= 8000 && dt <= 18000;
        const score = inWindow ? Math.abs(dt - 12000) : 50_000 + Math.abs(dt - 12000);
        if (score < bestScore) {
          bestScore = score;
          best = rec;
        }
      }
      return best.instanceId;
    }
    return records[records.length - 1].instanceId;
  }

  if (event.type === 'ANSWERED') {
    const answering = lastPending(records, pending.answer);
    if (answering) return answering;
    const incoming = [...records].reverse().find((r) => r.view.phase === 'incoming');
    if (incoming) return incoming.instanceId;
  }

  if (event.type === 'HELD') {
    const holding = lastPending(records, pending.hold);
    if (holding) return holding;
  }
  if (event.type === 'RESUMED') {
    const resuming = lastPending(records, pending.resume);
    if (resuming) return resuming;
  }
  if (event.type === 'MUTED') {
    const muting = lastPending(records, pending.mute);
    if (muting) return muting;
  }
  if (event.type === 'UNMUTED') {
    const unmuting = lastPending(records, pending.unmute);
    if (unmuting) return unmuting;
  }

  const live = [...records].reverse().find((r) => r.view.phase !== 'ended');
  return live?.instanceId ?? records[records.length - 1].instanceId;
}

export function createBoard(): CallBoard {
  return { calls: {}, byEngineId: {}, seen: new Set(), gen: 0 };
}

export type IngestStatus = 'applied' | 'duplicate' | 'ignored';

export type IngestResult = {
  board: CallBoard;
  status: IngestStatus;
  instanceId?: string;
  event: CallEvent;
  /** Why a live event was not applied (duplicates / stale no_answer). */
  note?: string;
};

function markSeen(board: CallBoard, key: string): CallBoard {
  const seen = new Set(board.seen);
  seen.add(key);
  return { ...board, seen };
}

function shouldDropMissedTimeout(
  record: CallRecord | undefined,
  pending: ActionPendings,
): boolean {
  if (!record) return false;
  return (
    instanceHas(record, 'ANSWERED') ||
    pending.answer.has(record.instanceId) ||
    record.view.phase === 'active' ||
    record.view.phase === 'held'
  );
}

export function ingestEvent(
  board: CallBoard,
  event: CallEvent,
  pending: ActionPendings = emptyPendings(),
): IngestResult {
  const key = eventKey(event);
  if (board.seen.has(key)) {
    return {
      board,
      status: 'duplicate',
      event,
      instanceId: recordsFor(board, event.callId).slice(-1)[0]?.instanceId,
      note: 'Same type and timestamp as an event already in the log — ignored.',
    };
  }

  const records = recordsFor(board, event.callId);
  const isStart = event.type === 'INCOMING' || event.type === 'RINGING';
  let instanceId = isStart
    ? pickStartInstance(records, event)
    : pickLifecycleInstance(records, event, pending);

  let nextCalls = board.calls;
  let nextByEngine = board.byEngineId;
  let gen = board.gen;

  if (!instanceId) {
    gen += 1;
    instanceId = `${event.callId}#${gen}`;
    const created: CallRecord = {
      instanceId,
      engineCallId: event.callId,
      events: [],
      seen: new Set(),
      view: foldCall(instanceId, event.callId, []),
    };
    nextCalls = { ...board.calls, [instanceId]: created };
    nextByEngine = {
      ...board.byEngineId,
      [event.callId]: [...(board.byEngineId[event.callId] ?? []), instanceId],
    };
  }

  const existing = nextCalls[instanceId];
  if (existing.seen.has(key)) {
    return {
      board,
      status: 'duplicate',
      event,
      instanceId,
      note: 'Same type and timestamp as an event already in the log — ignored.',
    };
  }

  if (event.type === 'ENDED' && event.reason === 'no_answer' && shouldDropMissedTimeout(existing, pending)) {
    return {
      board: markSeen(
        {
          ...board,
          calls: nextCalls,
          byEngineId: nextByEngine,
          gen,
        },
        key,
      ),
      status: 'ignored',
      event,
      instanceId,
      note: 'Missed-call timeout after Answer — left the call on the line.',
    };
  }

  const events = [...existing.events, event];
  const seen = new Set(existing.seen);
  seen.add(key);

  const record: CallRecord = {
    ...existing,
    events,
    seen,
    view: foldCall(instanceId, event.callId, events),
  };

  return {
    board: {
      calls: { ...nextCalls, [instanceId]: record },
      byEngineId: nextByEngine,
      seen: new Set([...board.seen, key]),
      gen,
    },
    status: 'applied',
    event,
    instanceId,
  };
}

export function applyEvent(
  board: CallBoard,
  event: CallEvent,
  pending: ActionPendings = emptyPendings(),
): CallBoard {
  return ingestEvent(board, event, pending).board;
}

export function listCalls(board: CallBoard): CallView[] {
  return Object.values(board.calls)
    .map((record) => record.view)
    .sort((a, b) => a.lastAt - b.lastAt);
}

export function liveCalls(calls: CallView[]): CallView[] {
  return calls.filter((call) => call.phase !== 'ended');
}

export function primaryCall(calls: CallView[]): CallView | undefined {
  const live = liveCalls(calls);
  return live.find((c) => c.phase === 'active' || c.phase === 'held') ?? live[0];
}

/**
 * Softphone invariant: at most one call is Active.
 * Peers the agent already left (or is leaving) render as On hold until HELD arrives.
 */
export function withExclusiveLine(calls: CallView[], talkingInstanceId: string | null): CallView[] {
  const live = liveCalls(calls);
  const talkingLive =
    talkingInstanceId && live.some((c) => c.instanceId === talkingInstanceId)
      ? talkingInstanceId
      : (live.find((c) => c.phase === 'active')?.instanceId ?? null);

  if (!talkingLive) return calls;

  return calls.map((call) => {
    if (call.phase === 'active' && call.instanceId !== talkingLive) {
      return { ...call, phase: 'held' };
    }
    return call;
  });
}

/** Other live calls that must be held before this line can be the talking call. */
export function peerIdsToHold(
  live: CallView[],
  exceptInstanceId: string,
  pendingAnswer: Set<string>,
): string[] {
  return live
    .filter((call) => call.instanceId !== exceptInstanceId)
    .filter((call) => call.phase === 'active' || pendingAnswer.has(call.instanceId))
    .map((call) => call.instanceId);
}
