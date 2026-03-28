import type { Message } from '../lib/types';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface MessageCardProps {
  message: Message;
}

export function MessageCard({ message }: MessageCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-medium">
          {message.author_name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-gray-900">
              {message.author_name}
            </span>
            {message.channel_name && (
              <>
                <span className="text-gray-400">in</span>
                <span className="text-indigo-600 font-medium">
                  #{message.channel_name}
                </span>
              </>
            )}
            <span className="text-gray-400 ml-auto flex-shrink-0">
              {timeAgo(message.posted_at)}
            </span>
          </div>
          <p className="mt-1 text-gray-700 whitespace-pre-wrap break-words">
            {message.content}
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            {message.reply_count > 0 && (
              <span>{message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}</span>
            )}
            {message.reaction_count > 0 && (
              <span>{message.reaction_count} {message.reaction_count === 1 ? 'reaction' : 'reactions'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
