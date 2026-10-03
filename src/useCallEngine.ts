'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from '@engine';
import type { CallEvent } from '@engine';
import {
  createBoard,
  emptyPendings,
  ingestEvent,
  listCalls,
  liveCalls,
  peerIdsToHold,
  primaryCall,
  withExclusiveLine,
  type ActionPendings,
  type CallView,
  type IngestResult,
} from './callModel';

export type PendingAction = 'answer' | 'hangup' | 'hold' | 'resume' | 'mute' | 'unmute';

type Pendings = Record<string, Partial<Record<PendingAction, boolean>>>;

export type EventLogEntry = {
  id: number;
  status: IngestResult['status'];
  title: string;
  detail: string;
  callId: string;
};

function eventTitle(event: CallEvent): string {
  if (event.type === 'INCOMING') return `Incoming from ${event.from}`;
  if (event.type === 'ENDED') return `Ended (${event.reason.replaceAll('_', ' ')})`;
  return event.type.charAt(0) + event.type.slice(1).toLowerCase();
}

function clearPendingForEvent(pending: ActionPendings, instanceId: string, type: string) {
  if (type === 'ANSWERED') pending.answer.delete(instanceId);
  if (type === 'ENDED') pending.hangup.delete(instanceId);
  if (type === 'HELD') pending.hold.delete(instanceId);
  if (type === 'RESUMED') pending.resume.delete(instanceId);
  if (type === 'MUTED') pending.mute.delete(instanceId);
  if (type === 'UNMUTED') pending.unmute.delete(instanceId);
}

export function useCallEngine() {
  const [calls, setCalls] = useState<CallView[]>([]);
  const [pendings, setPendings] = useState<Pendings>({});
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const boardRef = useRef(createBoard());
  const pendingRef = useRef(emptyPendings());
  const talkingRef = useRef<string | null>(null);
  const firstSeenRef = useRef<Record<string, number>>({});
  const logId = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const publish = (instanceId?: string, eventType?: string) => {
    const listed = listCalls(boardRef.current);
    for (const call of listed) {
      if (firstSeenRef.current[call.instanceId] === undefined) {
        firstSeenRef.current[call.instanceId] = Date.now();
      }
    }
    setCalls(withExclusiveLine(listed, talkingRef.current));

    if (!instanceId || !eventType) return;

    setPendings((prev) => {
      const current = { ...prev[instanceId] };
      if (eventType === 'ANSWERED') delete current.answer;
      if (eventType === 'ENDED') delete current.hangup;
      if (eventType === 'HELD') delete current.hold;
      if (eventType === 'RESUMED') delete current.resume;
      if (eventType === 'MUTED') delete current.mute;
      if (eventType === 'UNMUTED') delete current.unmute;
      const view = listed.find((c) => c.instanceId === instanceId);
      if (view?.phase === 'ended') {
        const rest = { ...prev };
        delete rest[instanceId];
        return rest;
      }
      return { ...prev, [instanceId]: current };
    });
  };

  useEffect(() => {
    const unsubscribe = engine.on((event) => {
      const result = ingestEvent(boardRef.current, event, pendingRef.current);
      boardRef.current = result.board;

      logId.current += 1;
      const entry: EventLogEntry = {
        id: logId.current,
        status: result.status,
        title: eventTitle(event),
        detail:
          result.status === 'duplicate'
            ? (result.note ?? 'Duplicate — already in the system, ignored.')
            : result.status === 'ignored'
              ? (result.note ?? 'Ignored.')
              : `Applied to ${event.callId}.`,
        callId: event.callId,
      };
      setEventLog((prev) => [entry, ...prev].slice(0, 40));

      if (result.status === 'applied' && result.instanceId) {
        clearPendingForEvent(pendingRef.current, result.instanceId, event.type);
        if (event.type === 'ENDED' && talkingRef.current === result.instanceId) {
          talkingRef.current = null;
        }
        publish(result.instanceId, event.type);
      } else if (result.status !== 'duplicate') {
        publish();
      }
    });

    engine.start();
    return unsubscribe;
  }, []);

  const markPending = (instanceId: string, action: PendingAction) => {
    pendingRef.current[action].add(instanceId);
    setPendings((prev) => ({
      ...prev,
      [instanceId]: { ...prev[instanceId], [action]: true },
    }));
  };

  const holdPeers = (exceptInstanceId: string) => {
    const live = liveCalls(listCalls(boardRef.current));
    for (const instanceId of peerIdsToHold(live, exceptInstanceId, pendingRef.current.answer)) {
      const rec = boardRef.current.calls[instanceId];
      if (!rec) continue;
      markPending(instanceId, 'hold');
      engine.hold(rec.view.engineCallId);
    }
  };

  const answer = useCallback((instanceId: string) => {
    const rec = boardRef.current.calls[instanceId];
    if (!rec) return;
    holdPeers(instanceId);
    talkingRef.current = instanceId;
    markPending(instanceId, 'answer');
    engine.answer(rec.view.engineCallId);
    publish();
  }, []);

  const hangup = useCallback((instanceId: string) => {
    const rec = boardRef.current.calls[instanceId];
    if (!rec) return;
    markPending(instanceId, 'hangup');
    engine.hangup(rec.view.engineCallId);
  }, []);

  const hold = useCallback((instanceId: string) => {
    const rec = boardRef.current.calls[instanceId];
    if (!rec) return;
    if (talkingRef.current === instanceId) talkingRef.current = null;
    markPending(instanceId, 'hold');
    engine.hold(rec.view.engineCallId);
    publish();
  }, []);

  const resume = useCallback((instanceId: string) => {
    const rec = boardRef.current.calls[instanceId];
    if (!rec) return;
    holdPeers(instanceId);
    talkingRef.current = instanceId;
    markPending(instanceId, 'resume');
    engine.resume(rec.view.engineCallId);
    publish();
  }, []);

  const mute = useCallback((instanceId: string) => {
    const rec = boardRef.current.calls[instanceId];
    if (!rec) return;
    markPending(instanceId, 'mute');
    engine.mute(rec.view.engineCallId);
  }, []);

  const unmute = useCallback((instanceId: string) => {
    const rec = boardRef.current.calls[instanceId];
    if (!rec) return;
    markPending(instanceId, 'unmute');
    engine.unmute(rec.view.engineCallId);
  }, []);

  const presented = withExclusiveLine(calls, talkingRef.current);
  const live = liveCalls(presented);
  const ended = presented.filter((c) => c.phase === 'ended').slice(-3);
  const elapsed: Record<string, number> = {};
  for (const call of presented) {
    const start = firstSeenRef.current[call.instanceId];
    elapsed[call.instanceId] = start === undefined ? 0 : Math.max(0, now - start);
  }

  return {
    idle: live.length === 0,
    live,
    waiting: live.filter((c) => c.phase === 'incoming'),
    primary: primaryCall(presented),
    recentEnded: ended,
    pendings,
    eventLog,
    elapsed,
    answer,
    hangup,
    hold,
    resume,
    mute,
    unmute,
  };
}
