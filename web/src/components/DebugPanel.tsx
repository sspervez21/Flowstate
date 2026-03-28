import type { Message } from '../lib/types';

interface DebugPanelProps {
  pages: Message[][];
}

const SIGNAL_LABELS: Record<string, string> = {
  mention: 'Direct mention',
  action_item: 'Action item / question',
  channel_affinity: 'Channel you are active in',
  engagement: 'High engagement (reactions/replies)',
  content_relevance: 'Content matches your interests',
  user_rule: 'Custom rule match',
};

const SIGNAL_COLORS: Record<string, string> = {
  mention: 'bg-red-100 text-red-700',
  action_item: 'bg-orange-100 text-orange-700',
  channel_affinity: 'bg-blue-100 text-blue-700',
  engagement: 'bg-purple-100 text-purple-700',
  content_relevance: 'bg-green-100 text-green-700',
  user_rule: 'bg-yellow-100 text-yellow-700',
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.8
      ? 'bg-green-500'
      : score >= 0.5
        ? 'bg-yellow-500'
        : score >= 0.3
          ? 'bg-orange-500'
          : 'bg-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function DebugPanel({ pages }: DebugPanelProps) {
  const messages = pages.flat();
  const scored = messages.filter((m) => m.relevance_score != null);
  const unscored = messages.filter((m) => m.relevance_score == null);

  if (messages.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p>No messages to debug</p>
        <p className="text-sm mt-1">Sync messages first, then trigger scoring</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {/* Summary */}
      <div className="px-5 py-3 bg-gray-50 text-sm text-gray-500">
        {scored.length} scored / {unscored.length} unscored of {messages.length} messages
      </div>

      {/* Scored messages */}
      {scored
        .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
        .map((msg) => (
          <div key={msg.id} className="px-5 py-3">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-gray-900">
                {msg.author_name}
              </span>
              {msg.channel_name && (
                <span className="text-xs text-gray-400">#{msg.channel_name}</span>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                {formatTime(msg.posted_at)}
              </span>
            </div>

            {/* Message preview */}
            <p className="text-sm text-gray-600 truncate mb-2">
              {msg.content.slice(0, 120)}
              {msg.content.length > 120 ? '...' : ''}
            </p>

            {/* Score bar */}
            <ScoreBar score={msg.relevance_score ?? 0} />

            {/* Signals breakdown */}
            {msg.relevance_signals && Object.keys(msg.relevance_signals).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Object.entries(msg.relevance_signals)
                  .filter(([, v]) => v > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([signal, value]) => (
                    <span
                      key={signal}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SIGNAL_COLORS[signal] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {SIGNAL_LABELS[signal] ?? signal}
                      <span className="opacity-60">+{(value * 100).toFixed(0)}%</span>
                    </span>
                  ))}
              </div>
            )}
          </div>
        ))}

      {/* Unscored messages */}
      {unscored.length > 0 && (
        <>
          <div className="px-5 py-2 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Not yet scored
          </div>
          {unscored.map((msg) => (
            <div key={msg.id} className="px-5 py-2 text-sm text-gray-400 flex items-center gap-2">
              <span className="font-medium text-gray-500">{msg.author_name}</span>
              <span className="truncate">{msg.content.slice(0, 80)}</span>
              <span className="ml-auto text-xs flex-shrink-0">{formatTime(msg.posted_at)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
