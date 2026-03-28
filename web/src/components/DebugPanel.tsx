import { useState } from 'react';
import type { Message } from '../lib/types';
import type { ScoringRunBanner } from '../lib/scoringUi';

interface DebugPanelProps {
  pages: Message[][];
  isScoring?: boolean;
  scoringRunBanner?: ScoringRunBanner | null;
  onDismissScoringBanner?: () => void;
}

const SIGNAL_LABELS: Record<string, string> = {
  mention: 'Mention',
  action_item: 'Action item',
  channel_affinity: 'Active channel',
  engagement: 'Engagement',
  content_relevance: 'Content match',
  user_rule: 'Custom rule',
};

const SIGNAL_COLORS: Record<string, string> = {
  mention: 'bg-red-100 text-red-700',
  action_item: 'bg-orange-100 text-orange-700',
  channel_affinity: 'bg-blue-100 text-blue-700',
  engagement: 'bg-purple-100 text-purple-700',
  content_relevance: 'bg-green-100 text-green-700',
  user_rule: 'bg-yellow-100 text-yellow-700',
};

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-green-600';
  if (score >= 0.5) return 'text-yellow-600';
  if (score >= 0.3) return 'text-orange-500';
  return 'text-red-400';
}

function dotColor(score: number): string {
  if (score >= 0.8) return 'bg-green-500';
  if (score >= 0.5) return 'bg-yellow-500';
  if (score >= 0.3) return 'bg-orange-500';
  return 'bg-red-400';
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function DebugPanel({
  pages,
  isScoring,
  scoringRunBanner,
  onDismissScoringBanner,
}: DebugPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const messages = pages.flat();
  const scored = messages.filter((m) => m.relevance_score != null);
  const unscored = messages.filter((m) => m.relevance_score == null);

  const lastScoredAt = scored.reduce<string | null>((latest, m) => {
    if (!m.relevance_scored_at) return latest;
    if (!latest) return m.relevance_scored_at;
    return m.relevance_scored_at > latest ? m.relevance_scored_at : latest;
  }, null);

  if (messages.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p>No messages to debug</p>
        <p className="text-sm mt-1">Sync messages first, then trigger scoring</p>
      </div>
    );
  }

  const bannerStyles =
    scoringRunBanner?.variant === 'error'
      ? 'bg-red-50 text-red-800 border-red-200'
      : scoringRunBanner?.variant === 'warning'
        ? 'bg-amber-50 text-amber-900 border-amber-200'
        : 'bg-emerald-50 text-emerald-900 border-emerald-200';

  return (
    <div>
      {scoringRunBanner && (
        <div
          className={`mx-5 mt-3 mb-1 px-3 py-2 rounded-md border text-sm flex gap-2 items-start ${bannerStyles}`}
          role="status"
        >
          <p className="flex-1 min-w-0 whitespace-pre-wrap break-words">{scoringRunBanner.text}</p>
          {onDismissScoringBanner && (
            <button
              type="button"
              onClick={onDismissScoringBanner}
              className="flex-shrink-0 text-xs opacity-70 hover:opacity-100 underline"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="text-xs text-gray-400">
          {scored.length} scored, {unscored.length} pending
          {lastScoredAt && <> &middot; Last run: {formatDateTime(lastScoredAt)}</>}
        </div>
        {isScoring && (
          <span className="text-xs text-blue-500 animate-pulse flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Scoring...
          </span>
        )}
      </div>

      {/* Compact scored list */}
      {scored
        .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
        .map((msg) => {
          const score = msg.relevance_score ?? 0;
          const signals = msg.relevance_signals ?? {};
          const activeSignals = Object.entries(signals).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
          const isExpanded = expandedId === msg.id;

          return (
            <div key={msg.id} className="border-b border-gray-50">
              {/* Compact row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : msg.id)}
                className="w-full text-left px-5 py-2 hover:bg-gray-50 flex items-center gap-3 transition-colors"
              >
                {/* Score */}
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor(score)}`} />
                <span className={`text-xs font-mono w-8 flex-shrink-0 ${scoreColor(score)}`}>
                  {Math.round(score * 100)}%
                </span>

                {/* Author + preview */}
                <span className="text-sm text-gray-900 font-medium flex-shrink-0 w-28 truncate">
                  {msg.author_name}
                </span>
                <span className="text-sm text-gray-500 truncate flex-1">
                  {msg.content.slice(0, 80)}
                </span>

                {/* Top signals (inline, compact) */}
                <span className="flex gap-1 flex-shrink-0">
                  {activeSignals.slice(0, 2).map(([signal]) => (
                    <span
                      key={signal}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SIGNAL_COLORS[signal] ?? 'bg-gray-100 text-gray-500'}`}
                    >
                      {SIGNAL_LABELS[signal] ?? signal}
                    </span>
                  ))}
                  {activeSignals.length > 2 && (
                    <span className="text-[10px] text-gray-400 self-center">
                      +{activeSignals.length - 2}
                    </span>
                  )}
                </span>

                {/* Channel + time */}
                {msg.channel_name && (
                  <span className="text-[10px] text-gray-300 flex-shrink-0 w-20 truncate text-right">
                    #{msg.channel_name}
                  </span>
                )}
                <span className="text-[10px] text-gray-300 flex-shrink-0 w-14 text-right">
                  {formatTime(msg.posted_at)}
                </span>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-5 pb-3 pt-1 bg-gray-50/50">
                  <p className="text-sm text-gray-600 mb-2 whitespace-pre-wrap">
                    {msg.content}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {activeSignals.map(([signal, value]) => (
                      <span
                        key={signal}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SIGNAL_COLORS[signal] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {SIGNAL_LABELS[signal] ?? signal}
                        <span className="opacity-60">+{(value * 100).toFixed(0)}%</span>
                      </span>
                    ))}
                  </div>
                  {msg.relevance_scored_at && (
                    <div className="text-[10px] text-gray-300 mt-2">
                      Scored {formatDateTime(msg.relevance_scored_at)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

      {/* Unscored */}
      {unscored.length > 0 && (
        <div className="px-5 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
          {unscored.length} message{unscored.length !== 1 ? 's' : ''} pending scoring
        </div>
      )}
    </div>
  );
}
