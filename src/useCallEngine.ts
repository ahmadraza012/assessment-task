import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from './callEngine';
import {
  applyEvent,
  createBoard,
  listCalls,
  liveCalls,
  primaryCall,
  type CallView,
} from './callModel';

export type PendingAction = 'answer' | 'hangup' | 'hold' | 'resume' | 'mute' | 'unmute';

type Pendings = Record<string, Partial<Record<PendingAction, boolean>>>;

export function useCallEngine() {
  const [calls, setCalls] = useState<CallView[]>([]);
  const [pendings, setPendings] = useState<Pendings>({});
  const boardRef = useRef(createBoard());

  useEffect(() => {
    const unsubscribe = engine.on((event) => {
      boardRef.current = applyEvent(boardRef.current, event);
      const next = listCalls(boardRef.current);
      setCalls(next);

      const view = next.find((c) => c.callId === event.callId);
      if (!view) return;

      setPendings((prev) => {
        const current = { ...prev[event.callId] };
        if (event.type === 'ANSWERED') delete current.answer;
        if (event.type === 'ENDED') delete current.hangup;
        if (event.type === 'HELD') delete current.hold;
        if (event.type === 'RESUMED') delete current.resume;
        if (event.type === 'MUTED') delete current.mute;
        if (event.type === 'UNMUTED') delete current.unmute;
        if (view.phase === 'ended') {
          const rest = { ...prev };
          delete rest[event.callId];
          return rest;
        }
        return { ...prev, [event.callId]: current };
      });
    });

    engine.start();
    return unsubscribe;
  }, []);

  const markPending = (callId: string, action: PendingAction) => {
    setPendings((prev) => ({
      ...prev,
      [callId]: { ...prev[callId], [action]: true },
    }));
  };

  const answer = useCallback((callId: string) => {
    const live = liveCalls(listCalls(boardRef.current));
    const current = live.find((c) => c.phase === 'active');
    if (current && current.callId !== callId) {
      markPending(current.callId, 'hold');
      engine.hold(current.callId);
    }
    markPending(callId, 'answer');
    engine.answer(callId);
  }, []);

  const hangup = useCallback((callId: string) => {
    markPending(callId, 'hangup');
    engine.hangup(callId);
  }, []);

  const hold = useCallback((callId: string) => {
    markPending(callId, 'hold');
    engine.hold(callId);
  }, []);

  const resume = useCallback((callId: string) => {
    markPending(callId, 'resume');
    engine.resume(callId);
  }, []);

  const mute = useCallback((callId: string) => {
    markPending(callId, 'mute');
    engine.mute(callId);
  }, []);

  const unmute = useCallback((callId: string) => {
    markPending(callId, 'unmute');
    engine.unmute(callId);
  }, []);

  const live = liveCalls(calls);
  const ended = calls.filter((c) => c.phase === 'ended').slice(-3);

  return {
    idle: live.length === 0,
    live,
    waiting: live.filter((c) => c.phase === 'incoming'),
    primary: primaryCall(calls),
    recentEnded: ended,
    pendings,
    answer,
    hangup,
    hold,
    resume,
    mute,
    unmute,
  };
}
