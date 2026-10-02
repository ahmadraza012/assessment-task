import type { CallEvent } from './callEngine';

/** Lifecycle the panel renders. Mute is orthogonal and stored separately. */
export type CallPhase = 'incoming' | 'active' | 'held' | 'ended';

export type CallView = {
  callId: string;
  from: string;
  phase: CallPhase;
  muted: boolean;
  endedReason?: string;
  /** Logical engine time of the latest applied event. */
  lastAt: number;
};

type CallRecord = {
  events: CallEvent[];
  /** Dedup: engine re-fires the same object (`type` + `at`). */
  seen: Set<string>;
  view: CallView;
};

export type CallBoard = {
  calls: Record<string, CallRecord>;
};

const eventKey = (e: CallEvent) => `${e.callId}:${e.type}:${e.at}`;

function foldCall(callId: string, events: CallEvent[]): CallView {
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

    // Terminal is sticky: a later ANSWERED/RINGING must not resurrect
    // a call after ENDED. Action jitter can emit ANSWERED after hangup.
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

  return { callId, from, phase, muted, endedReason, lastAt };
}

export function createBoard(): CallBoard {
  return { calls: {} };
}

export function applyEvent(board: CallBoard, event: CallEvent): CallBoard {
  const key = eventKey(event);
  const existing = board.calls[event.callId];

  if (existing?.seen.has(key)) {
    return board;
  }

  const events = existing ? [...existing.events, event] : [event];
  const seen = new Set(existing?.seen);
  seen.add(key);

  return {
    calls: {
      ...board.calls,
      [event.callId]: {
        events,
        seen,
        view: foldCall(event.callId, events),
      },
    },
  };
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
