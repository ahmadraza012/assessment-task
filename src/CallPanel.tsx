'use client';

import type { CallView } from './callModel';
import type { EventLogEntry, PendingAction } from './useCallEngine';
import { useCallEngine } from './useCallEngine';

const phaseLabel: Record<CallView['phase'], string> = {
  incoming: 'Ringing',
  active: 'On the line',
  held: 'On hold',
  ended: 'Ended',
};

function formatFrom(from: string) {
  if (from.startsWith('+1') && from.length === 12) {
    return `+1 (${from.slice(2, 5)}) ${from.slice(5, 8)}-${from.slice(8)}`;
  }
  return from;
}

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function CallCard({
  call,
  pending,
  elapsedMs,
  onAnswer,
  onHangup,
  onHold,
  onResume,
  onMute,
  onUnmute,
}: {
  call: CallView;
  pending?: Partial<Record<PendingAction, boolean>>;
  elapsedMs: number;
  onAnswer: (id: string) => void;
  onHangup: (id: string) => void;
  onHold: (id: string) => void;
  onResume: (id: string) => void;
  onMute: (id: string) => void;
  onUnmute: (id: string) => void;
}) {
  const ended = call.phase === 'ended';
  const incoming = call.phase === 'incoming';
  const connected = call.phase === 'active' || call.phase === 'held';

  return (
    <article className={`card phase-${call.phase}${call.muted ? ' is-muted' : ''}`}>
      <header className="card-head">
        <span className={`badge badge-${call.phase}`}>{phaseLabel[call.phase]}</span>
        {call.muted && connected && <span className="badge badge-mute">Muted</span>}
        {!ended && (
          <span className="clock" title="Updates once per second">
            {incoming ? 'Ringing' : 'Talk time'} {formatElapsed(elapsedMs)}
          </span>
        )}
      </header>
      <p className="from">{formatFrom(call.from)}</p>
      <p className="meta">{call.engineCallId}</p>
      <p className="explain">
        {incoming &&
          'This caller is waiting. Answer puts them on your line. Decline hangs up and files the call as Ended.'}
        {call.phase === 'active' &&
          'You are talking to this caller. Hold parks them. Hang up ends the call and moves it to Ended.'}
        {call.phase === 'held' &&
          'This caller is parked. Resume makes them the Active line (the other live call is held first).'}
        {ended &&
          `This call is over${call.endedReason ? ` (${call.endedReason.replaceAll('_', ' ')})` : ''}. It is no longer on your line.`}
      </p>
      {!ended && (
        <div className="actions">
          {incoming && (
            <div className="cta">
              <button
                type="button"
                className="btn btn-answer"
                disabled={!!pending?.answer}
                onClick={() => onAnswer(call.instanceId)}
              >
                {pending?.answer ? 'Connecting…' : 'Answer'}
              </button>
              <span className="cta-hint">Take the call → status On the line</span>
            </div>
          )}
          {call.phase === 'active' && (
            <div className="cta">
              <button
                type="button"
                className="btn"
                disabled={!!pending?.hold}
                onClick={() => onHold(call.instanceId)}
              >
                {pending?.hold ? 'Holding…' : 'Hold'}
              </button>
              <span className="cta-hint">Park this caller → On hold</span>
            </div>
          )}
          {call.phase === 'held' && (
            <div className="cta">
              <button
                type="button"
                className="btn"
                disabled={!!pending?.resume}
                onClick={() => onResume(call.instanceId)}
              >
                {pending?.resume ? 'Resuming…' : 'Resume'}
              </button>
              <span className="cta-hint">Return to this caller → On the line</span>
            </div>
          )}
          {connected &&
            (call.muted ? (
              <div className="cta">
                <button
                  type="button"
                  className="btn"
                  disabled={!!pending?.unmute}
                  onClick={() => onUnmute(call.instanceId)}
                >
                  {pending?.unmute ? 'Unmuting…' : 'Unmute'}
                </button>
                <span className="cta-hint">They can hear you again</span>
              </div>
            ) : (
              <div className="cta">
                <button
                  type="button"
                  className="btn"
                  disabled={!!pending?.mute}
                  onClick={() => onMute(call.instanceId)}
                >
                  {pending?.mute ? 'Muting…' : 'Mute'}
                </button>
                <span className="cta-hint">They will not hear you</span>
              </div>
            ))}
          <div className="cta">
            <button
              type="button"
              className="btn btn-end"
              disabled={!!pending?.hangup}
              onClick={() => onHangup(call.instanceId)}
            >
              {pending?.hangup ? 'Ending…' : incoming ? 'Decline' : 'Hang up'}
            </button>
            <span className="cta-hint">
              {incoming ? 'Reject without talking → Ended' : 'Disconnect → Ended'}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

function EventSidebar({ log }: { log: EventLogEntry[] }) {
  return (
    <aside className="log-panel" aria-label="Engine event log">
      <h2>Event log</h2>
      <p className="log-intro">
        The mock engine sometimes delivers the same event twice. Duplicates are not applied
        again — they show up here so you can see they were ignored.
      </p>
      {log.length === 0 && <p className="log-empty">Waiting for the first event…</p>}
      <ol className="log-list">
        {log.map((entry) => (
          <li key={entry.id} className={`log-item log-${entry.status}`}>
            <span className="log-tag">
              {entry.status === 'duplicate'
                ? 'Duplicate ignored'
                : entry.status === 'ignored'
                  ? 'Not applied'
                  : 'Applied'}
            </span>
            <strong>{entry.title}</strong>
            <span className="log-detail">{entry.detail}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function CallPanel() {
  const {
    idle,
    live,
    waiting,
    recentEnded,
    pendings,
    eventLog,
    elapsed,
    answer,
    hangup,
    hold,
    resume,
    mute,
    unmute,
  } = useCallEngine();

  const connected = live.filter((c) => c.phase === 'active' || c.phase === 'held');
  const incoming = live.filter((c) => c.phase === 'incoming');

  return (
    <div className="workspace">
      <main className="shell">
        <header className="top">
          <h1>Call panel</h1>
          <p className="sub">
            One agent line. Incoming calls wait until you Answer (talk) or Decline (hang up).
            Talk time on each card ticks once per second.
          </p>
        </header>

        <ul className="legend">
          <li>
            <span className="badge badge-incoming">Ringing</span> waiting — use Answer or Decline
          </li>
          <li>
            <span className="badge badge-active">On the line</span> you are in the call
          </li>
          <li>
            <span className="badge badge-held">On hold</span> parked while you handle another call
          </li>
          <li>
            <span className="badge badge-ended">Ended</span> finished — only Decline / Hang up
            should put a call here
          </li>
        </ul>

        {idle && <p className="idle">Idle — no live calls. An incoming ring will show up here.</p>}

        {waiting.length > 0 && connected.length > 0 && (
          <p className="notice">
            Another call is ringing. Answer it to talk to that caller; the current line goes on
            hold automatically.
          </p>
        )}

        {incoming.length > 0 && (
          <section>
            <h2>Waiting to be answered</h2>
            {incoming.map((call) => (
              <CallCard
                key={call.instanceId}
                call={call}
                pending={pendings[call.instanceId]}
                elapsedMs={elapsed[call.instanceId] ?? 0}
                onAnswer={answer}
                onHangup={hangup}
                onHold={hold}
                onResume={resume}
                onMute={mute}
                onUnmute={unmute}
              />
            ))}
          </section>
        )}

        {connected.length > 0 && (
          <section>
            <h2>On this line</h2>
            {connected.map((call) => (
              <CallCard
                key={call.instanceId}
                call={call}
                pending={pendings[call.instanceId]}
                elapsedMs={elapsed[call.instanceId] ?? 0}
                onAnswer={answer}
                onHangup={hangup}
                onHold={hold}
                onResume={resume}
                onMute={mute}
                onUnmute={unmute}
              />
            ))}
          </section>
        )}

        {recentEnded.length > 0 && (
          <section>
            <h2>Recently ended</h2>
            {recentEnded.map((call) => (
              <CallCard
                key={call.instanceId}
                call={call}
                pending={pendings[call.instanceId]}
                elapsedMs={elapsed[call.instanceId] ?? 0}
                onAnswer={answer}
                onHangup={hangup}
                onHold={hold}
                onResume={resume}
                onMute={mute}
                onUnmute={unmute}
              />
            ))}
          </section>
        )}
      </main>
      <EventSidebar log={eventLog} />
    </div>
  );
}
