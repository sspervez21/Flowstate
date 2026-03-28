import type { Message } from '../lib/types';
import type { ReactNode } from 'react';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Parse message text and highlight @mentions and #channels like Slack.
 * Only matches @Name patterns where the name starts with an uppercase letter
 * (resolved Slack mentions), not arbitrary @-words in regular text.
 */
function renderContent(text: string): ReactNode[] {
  // Match @FirstName LastName (capitalized, 1-3 words) or #channel-name (lowercase)
  const parts = text.split(/(@[A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+){0,3}|#[a-z][\w-]*)/g);

  return parts.map((part, i) => {
    if (/^@[A-Z]/.test(part)) {
      return (
        <span
          key={i}
          className="bg-[#D1ECFF] text-[#1264A3] rounded px-0.5 font-medium cursor-default"
        >
          {part}
        </span>
      );
    }
    if (part.startsWith('#')) {
      return (
        <span
          key={i}
          className="text-[#1264A3] font-medium cursor-pointer hover:underline"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

interface MessageCardProps {
  message: Message;
}

export function MessageCard({ message }: MessageCardProps) {
  return (
    <div className="flex gap-2 px-5 py-1.5 hover:bg-gray-50 group">
      <div className="flex-shrink-0 w-9 h-9 rounded-md bg-[#3F0E40] text-white flex items-center justify-center text-sm font-bold mt-0.5">
        {message.author_name?.[0]?.toUpperCase() ?? '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-gray-900 text-[15px]">
            {message.author_name}
          </span>
          {message.channel_name && (
            <span className="text-xs text-gray-400">
              in #{message.channel_name}
            </span>
          )}
          <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
            {formatTime(message.posted_at)}
          </span>
        </div>
        <p className="text-[15px] text-gray-800 whitespace-pre-wrap break-words leading-snug">
          {renderContent(message.content)}
        </p>
        {(message.reply_count > 0 || message.reaction_count > 0) && (
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
            {message.reply_count > 0 && (
              <span className="text-blue-600 font-medium hover:underline cursor-pointer">
                {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
              </span>
            )}
            {message.reaction_count > 0 && (
              <span>{message.reaction_count} reactions</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
