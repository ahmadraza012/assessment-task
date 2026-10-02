/**
 * callEngine.ts — mock call engine for the take-home task.
 *
 * This simulates a real telephony engine. DO NOT modify this file.
 * It emits call events over time. Actions (answer/hangup/hold/mute) are async
 * and may resolve OUT OF ORDER. Some events arrive late or duplicated — on
 * purpose. Your UI must stay correct anyway.
 */

export type CallEvent =
  | { type: 'INCOMING'; callId: string; from: string; at: number }
  | { type: 'RINGING'; callId: string; at: number }
  | { type: 'ANSWERED'; callId: string; at: number }
  | { type: 'HELD'; callId: string; at: number }
  | { type: 'RESUMED'; callId: string; at: number }
  | { type: 'MUTED'; callId: string; at: number }
  | { type: 'UNMUTED'; callId: string; at: number }
  | { type: 'ENDED'; callId: string; reason: string; at: number };

type Listener = (e: CallEvent) => void;

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min);
const jitter = () => rand(50, 1800); // late/out-of-order delivery
const maybeDuplicate = () => Math.random() < 0.15; // 15% of events fire twice

export class MockCallEngine {
  private listeners = new Set<Listener>();
  private seq = 0;
  private started = false;

  on(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: Omit<CallEvent, 'at'>) {
    const evt = { ...e, at: Date.now() + this.seq++ } as CallEvent;
    const fire = () => this.listeners.forEach((l) => l(evt));
    setTimeout(fire, jitter());
    if (maybeDuplicate()) setTimeout(fire, jitter());
  }

  /** Begin the simulation: incoming calls arrive on a loose timer. */
  start() {
    if (this.started) return;
    this.started = true;

    const spawnIncoming = () => {
      const callId = `call_${rand(1000, 9999)}`;
      const from = `+1${rand(200, 999)}${rand(200, 999)}${rand(1000, 9999)}`;
      this.emit({ type: 'INCOMING', callId, from });
      this.emit({ type: 'RINGING', callId });
      // auto-ends if the agent never answers
      setTimeout(() => this.emit({ type: 'ENDED', callId, reason: 'no_answer' }), rand(9000, 15000));
      setTimeout(spawnIncoming, rand(6000, 12000));
    };

    setTimeout(spawnIncoming, 1200);
    // occasionally a SECOND call lands during an active one
    setTimeout(spawnIncoming, rand(4000, 8000));
  }

  // --- Agent actions. Async, may resolve out of order vs. the emitted event. ---

  answer(callId: string) {
    setTimeout(() => this.emit({ type: 'ANSWERED', callId }), jitter());
  }

  hangup(callId: string) {
    setTimeout(() => this.emit({ type: 'ENDED', callId, reason: 'hangup' }), jitter());
  }

  hold(callId: string) {
    setTimeout(() => this.emit({ type: 'HELD', callId }), jitter());
  }

  resume(callId: string) {
    setTimeout(() => this.emit({ type: 'RESUMED', callId }), jitter());
  }

  mute(callId: string) {
    setTimeout(() => this.emit({ type: 'MUTED', callId }), jitter());
  }

  unmute(callId: string) {
    setTimeout(() => this.emit({ type: 'UNMUTED', callId }), jitter());
  }
}

export const engine = new MockCallEngine();
