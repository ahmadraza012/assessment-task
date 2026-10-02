import { describe, expect, it } from 'vitest';
import type { CallEvent } from './callEngine';
import { applyEvent, createBoard, listCalls } from './callModel';

const ev = (partial: CallEvent): CallEvent => partial;

function fold(events: CallEvent[]) {
  let board = createBoard();
  for (const event of events) {
    board = applyEvent(board, event);
  }
  return listCalls(board)[0];
}

describe('callModel', () => {
  it('treats INCOMING / RINGING as incoming even if RINGING arrives first', () => {
    const call = fold([
      ev({ type: 'RINGING', callId: 'c1', at: 1 }),
      ev({ type: 'INCOMING', callId: 'c1', from: '+15551212', at: 2 }),
    ]);
    expect(call.phase).toBe('incoming');
    expect(call.from).toBe('+15551212');
  });

  it('fills caller id when INCOMING is late', () => {
    const call = fold([
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
    board = applyEvent(board, event);
    expect(listCalls(board)).toHaveLength(1);
    expect(listCalls(board)[0].phase).toBe('active');
  });

  it('does not resurrect a call when a late ANSWERED has an earlier at than ENDED', () => {
    const call = fold([
      ev({ type: 'ENDED', callId: 'c1', reason: 'no_answer', at: 20 }),
      ev({ type: 'ANSWERED', callId: 'c1', at: 10 }),
      ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }),
    ]);
    expect(call.phase).toBe('ended');
    expect(call.endedReason).toBe('no_answer');
  });

  it('keeps ENDED sticky if ANSWERED is generated after hangup (higher at)', () => {
    const call = fold([
      ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }),
      ev({ type: 'ENDED', callId: 'c1', reason: 'hangup', at: 10 }),
      ev({ type: 'ANSWERED', callId: 'c1', at: 50 }),
    ]);
    expect(call.phase).toBe('ended');
  });

  it('derives held and muted independently', () => {
    const call = fold([
      ev({ type: 'INCOMING', callId: 'c1', from: 'x', at: 1 }),
      ev({ type: 'ANSWERED', callId: 'c1', at: 2 }),
      ev({ type: 'MUTED', callId: 'c1', at: 3 }),
      ev({ type: 'HELD', callId: 'c1', at: 4 }),
    ]);
    expect(call.phase).toBe('held');
    expect(call.muted).toBe(true);
  });

  it('resume after hold returns to active', () => {
    const call = fold([
      ev({ type: 'ANSWERED', callId: 'c1', at: 1 }),
      ev({ type: 'HELD', callId: 'c1', at: 2 }),
      ev({ type: 'RESUMED', callId: 'c1', at: 3 }),
    ]);
    expect(call.phase).toBe('active');
  });

  it('ignores hold/mute after the call has ended', () => {
    const call = fold([
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
    expect(calls.find((c) => c.callId === 'a')?.phase).toBe('active');
    expect(calls.find((c) => c.callId === 'b')?.phase).toBe('incoming');
  });
});
