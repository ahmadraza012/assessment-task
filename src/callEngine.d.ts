/**
 * Type surface for the provided mock engine.
 *
 * tsc never type-checks `callEngine.ts` (see tsconfig exclude + this shim).
 * The real file is wired at bundle time via the `@engine` alias in next.config.
 *
 * `emit` uses `Omit<CallEvent, 'at'>`, which does not distribute over the
 * CallEvent union, so extra properties like `from` / `reason` fail under
 * `tsc`. That is in the provided file; we do not edit it.
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

export declare class MockCallEngine {
  on(cb: (e: CallEvent) => void): () => void;
  start(): void;
  answer(callId: string): void;
  hangup(callId: string): void;
  hold(callId: string): void;
  resume(callId: string): void;
  mute(callId: string): void;
  unmute(callId: string): void;
}

export declare const engine: MockCallEngine;
