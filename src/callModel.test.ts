import { describe, expect, it } from 'vitest';
import type { CallEvent } from '@engine';
import {
  applyEvent,
  createBoard,
  emptyPendings,
  ingestEvent,
  listCalls,
  liveCalls,
  peerIdsToHold,
  withExclusiveLine,
} from './callModel';

const ev = (partial: CallEvent): CallEvent => partial;

function fold(events: CallEvent[]) {
  let board = createBoard();
  for (const event of events) {
    board = applyEvent(board, event);
  }
  return listCalls(board);
}

describe('callModel', () => {
  it('treats INCOMING / RINGING as incoming even if RINGING arrives first', () => {
    const [call] = fold([
      ev({ type: 'RINGING', callId: 'c1', at: 2 }),
      ev({ type: 'INCOMING', callId: 'c1', from: '+15551212', at: 1 }),
    ]);
    expect(call.phase).toBe('incoming');
    expect(call.from).toBe('+15551212');
  });

  it('fills caller id when INCOMING is late', () => {
    const [call] = fold([
      ev({ type: 'RINGING', callId: 'c1', at: 10 }),
      ev({ type: 'INCOMING', callId: 'c1', from: '+1999', at: 1 }),
    ]);
    expect(call.from).toBe('+1999');
    expect(call.phase).toBe('incoming');
  });

  it('ignores duplicate events with the same type and at', () => {
    const event = ev({ type: 'ANSWERED', callId: 'c1', at: 5 });
    let board = createBoard();
    board = applyEvent(board, ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }));
    board = applyEvent(board, event);
    const again = ingestEvent(board, event);
    expect(again.status).toBe('duplicate');
    expect(listCalls(again.board)).toHaveLength(1);
    expect(listCalls(again.board)[0].phase).toBe('active');
  });

  it('does not end an answered call on the mock no_answer timeout', () => {
    let board = createBoard();
    board = applyEvent(board, ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }));
    board = applyEvent(board, ev({ type: 'ANSWERED', callId: 'c1', at: 2 }));
    const missed = ingestEvent(
      board,
      ev({ type: 'ENDED', callId: 'c1', reason: 'no_answer', at: 20 }),
    );
    expect(missed.status).toBe('ignored');
    expect(listCalls(missed.board)[0].phase).toBe('active');
  });

  it('does not end a call the agent already chose to answer', () => {
    let board = createBoard();
    board = applyEvent(board, ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }));
    const pending = emptyPendings();
    pending.answer.add(listCalls(board)[0].instanceId);
    board = applyEvent(
      board,
      ev({ type: 'ENDED', callId: 'c1', reason: 'no_answer', at: 20 }),
      pending,
    );
    expect(listCalls(board)[0].phase).toBe('incoming');
    board = applyEvent(board, ev({ type: 'ANSWERED', callId: 'c1', at: 21 }), pending);
    expect(listCalls(board)[0].phase).toBe('active');
  });

  it('does not resurrect a call when a late ANSWERED has an earlier at than ENDED', () => {
    const [call] = fold([
      ev({ type: 'ENDED', callId: 'c1', reason: 'no_answer', at: 20 }),
      ev({ type: 'ANSWERED', callId: 'c1', at: 10 }),
      ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }),
    ]);
    expect(call.phase).toBe('ended');
    expect(call.endedReason).toBe('no_answer');
  });

  it('keeps ENDED sticky if ANSWERED is generated after hangup (higher at)', () => {
    const [call] = fold([
      ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }),
      ev({ type: 'ENDED', callId: 'c1', reason: 'hangup', at: 10 }),
      ev({ type: 'ANSWERED', callId: 'c1', at: 50 }),
    ]);
    expect(call.phase).toBe('ended');
  });

  it('derives held and muted independently', () => {
    const [call] = fold([
      ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }),
      ev({ type: 'ANSWERED', callId: 'c1', at: 2 }),
      ev({ type: 'MUTED', callId: 'c1', at: 3 }),
      ev({ type: 'HELD', callId: 'c1', at: 4 }),
    ]);
    expect(call.phase).toBe('held');
    expect(call.muted).toBe(true);
  });

  it('resume after hold returns to active', () => {
    const [call] = fold([
      ev({ type: 'ANSWERED', callId: 'c1', at: 1 }),
      ev({ type: 'HELD', callId: 'c1', at: 2 }),
      ev({ type: 'RESUMED', callId: 'c1', at: 3 }),
    ]);
    expect(call.phase).toBe('active');
  });

  it('ignores hold/mute after the call has ended', () => {
    const [call] = fold([
      ev({ type: 'ANSWERED', callId: 'c1', at: 1 }),
      ev({ type: 'ENDED', callId: 'c1', reason: 'hangup', at: 2 }),
      ev({ type: 'MUTED', callId: 'c1', at: 3 }),
      ev({ type: 'HELD', callId: 'c1', at: 4 }),
    ]);
    expect(call.phase).toBe('ended');
    expect(call.muted).toBe(false);
  });

  it('tracks two calls independently', () => {
    let board = createBoard();
    board = applyEvent(board, ev({ type: 'INCOMING', callId: 'a', from: '1', at: 1 }));
    board = applyEvent(board, ev({ type: 'ANSWERED', callId: 'a', at: 2 }));
    board = applyEvent(board, ev({ type: 'INCOMING', callId: 'b', from: '2', at: 3 }));
    const calls = listCalls(board);
    expect(calls.find((c) => c.engineCallId === 'a')?.phase).toBe('active');
    expect(calls.find((c) => c.engineCallId === 'b')?.phase).toBe('incoming');
  });

  it('does not merge a reused engine id into an ended call', () => {
    const calls = fold([
      ev({ type: 'INCOMING', callId: 'call_1', from: '+111', at: 1 }),
      ev({ type: 'ENDED', callId: 'call_1', reason: 'no_answer', at: 20 }),
      ev({ type: 'INCOMING', callId: 'call_1', from: '+222', at: 40 }),
      ev({ type: 'RINGING', callId: 'call_1', at: 41 }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.filter((c) => c.phase === 'ended')[0].from).toBe('+111');
    expect(calls.filter((c) => c.phase === 'incoming')[0].from).toBe('+222');
  });

  it('does not overwrite a live call when the engine reuses its id', () => {
    const calls = fold([
      ev({ type: 'INCOMING', callId: 'call_1', from: '+111', at: 1 }),
      ev({ type: 'RINGING', callId: 'call_1', at: 2 }),
      ev({ type: 'ANSWERED', callId: 'call_1', at: 3 }),
      ev({ type: 'INCOMING', callId: 'call_1', from: '+222', at: 50 }),
      ev({ type: 'RINGING', callId: 'call_1', at: 51 }),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.phase === 'active')?.from).toBe('+111');
    expect(calls.find((c) => c.phase === 'incoming')?.from).toBe('+222');
  });

  it('still pairs late INCOMING onto the same spawn as RINGING', () => {
    const calls = fold([
      ev({ type: 'RINGING', callId: 'call_1', at: 10 }),
      ev({ type: 'INCOMING', callId: 'call_1', from: '+111', at: 9 }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].from).toBe('+111');
  });
});

describe('exclusive talking line', () => {
  it('never presents two active calls', () => {
    const calls = fold([
      ev({ type: 'ANSWERED', callId: 'a', at: 1 }),
      ev({ type: 'ANSWERED', callId: 'b', at: 2 }),
    ]);
    const presented = withExclusiveLine(calls, calls.find((c) => c.engineCallId === 'b')!.instanceId);
    expect(presented.filter((c) => c.phase === 'active')).toHaveLength(1);
    expect(presented.find((c) => c.engineCallId === 'a')?.phase).toBe('held');
    expect(presented.find((c) => c.engineCallId === 'b')?.phase).toBe('active');
  });

  it('holds an in-flight answer when taking another ringing call', () => {
    const calls = fold([
      ev({ type: 'INCOMING', callId: 'a', from: '1', at: 1 }),
      ev({ type: 'INCOMING', callId: 'b', from: '2', at: 2 }),
    ]);
    const a = calls.find((c) => c.engineCallId === 'a')!;
    const b = calls.find((c) => c.engineCallId === 'b')!;
    expect(peerIdsToHold(liveCalls(calls), b.instanceId, new Set([a.instanceId]))).toEqual([
      a.instanceId,
    ]);
  });

  it('holds the current active call before resume', () => {
    const calls = fold([
      ev({ type: 'ANSWERED', callId: 'a', at: 1 }),
      ev({ type: 'ANSWERED', callId: 'b', at: 2 }),
      ev({ type: 'HELD', callId: 'b', at: 3 }),
    ]);
    const a = calls.find((c) => c.engineCallId === 'a')!;
    const b = calls.find((c) => c.engineCallId === 'b')!;
    expect(peerIdsToHold(liveCalls(calls), b.instanceId, emptyPendings().answer)).toEqual([
      a.instanceId,
    ]);
  });
});
