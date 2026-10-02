import type { CallView } from './callModel';
import type { PendingAction } from './useCallEngine';
import { useCallEngine } from './useCallEngine';

const phaseLabel: Record<CallView['phase'], string> = {
  incoming: 'Incoming',
  active: 'Active',
  held: 'On hold',
  ended: 'Ended',
};

function formatFrom(from: string) {
  if (from.startsWith('+1') && from.length === 12) {
    return `+1 (${from.slice(2, 5)}) ${from.slice(5, 8)}-${from.slice(8)}`;
  }
  return from;
}

function CallCard({
  call,
  pending,
  onAnswer,
  onHangup,
  onHold,
  onResume,
  onMute,
  onUnmute,
}: {
  call: CallView;
  pending?: Partial<Record<PendingAction, boolean>>;
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
      </header>
      <p className="from">{formatFrom(call.from)}</p>
      <p className="meta">
        {call.callId}
        {ended && call.endedReason ? ` · ${call.endedReason.replaceAll('_', ' ')}` : ''}
      </p>
      {!ended && (
        <div className="actions">
          {incoming && (
            <button
              className="btn btn-answer"
              disabled={!!pending?.answer}
              onClick={() => onAnswer(call.callId)}
            >
              {pending?.answer ? 'Answering…' : 'Answer'}
            </button>
          )}
          {call.phase === 'active' && (
            <button
              className="btn"
              disabled={!!pending?.hold}
              onClick={() => onHold(call.callId)}
            >
              {pending?.hold ? 'Holding…' : 'Hold'}
            </button>
          )}
          {call.phase === 'held' && (
            <button
              className="btn"
              disabled={!!pending?.resume}
              onClick={() => onResume(call.callId)}
            >
              {pending?.resume ? 'Resuming…' : 'Resume'}
            </button>
          )}
          {connected &&
            (call.muted ? (
              <button
                className="btn"
                disabled={!!pending?.unmute}
                onClick={() => onUnmute(call.callId)}
              >
                {pending?.unmute ? 'Unmuting…' : 'Unmute'}
              </button>
            ) : (
              <button
                className="btn"
                disabled={!!pending?.mute}
                onClick={() => onMute(call.callId)}
              >
                {pending?.mute ? 'Muting…' : 'Mute'}
              </button>
            ))}
          <button
            className="btn btn-end"
            disabled={!!pending?.hangup}
            onClick={() => onHangup(call.callId)}
          >
            {pending?.hangup ? 'Ending…' : incoming ? 'Decline' : 'Hang up'}
          </button>
        </div>
      )}
    </article>
  );
}

export function CallPanel() {
  const {
    idle,
    live,
    waiting,
    recentEnded,
    pendings,
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
    <main className="shell">
      <header className="top">
        <h1>Call panel</h1>
        <p className="sub">
          State is folded from engine events by <code>at</code> — late, duplicate, and
          out-of-order deliveries cannot skip the lifecycle.
        </p>
      </header>

      {idle && <p className="idle">Idle — waiting for an incoming call.</p>}

      {waiting.length > 0 && connected.length > 0 && (
        <p className="notice">
          {waiting.length === 1 ? 'A second call is waiting.' : `${waiting.length} calls waiting.`}{' '}
          Answering it will place the active call on hold.
        </p>
      )}

      {incoming.length > 0 && (
        <section>
          <h2>Incoming</h2>
          {incoming.map((call) => (
            <CallCard
              key={call.callId}
              call={call}
              pending={pendings[call.callId]}
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
              key={call.callId}
              call={call}
              pending={pendings[call.callId]}
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
              key={call.callId}
              call={call}
              pending={pendings[call.callId]}
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
  );
}
