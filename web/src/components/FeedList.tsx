import type { Message } from '../lib/types';
import { MessageCard } from './MessageCard';

interface FeedListProps {
  pages: Message[][];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function FeedList({ pages, hasNextPage, isFetchingNextPage, onLoadMore }: FeedListProps) {
  const allMessages = pages.flat();

  if (allMessages.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-base">No messages match this filter</p>
        <p className="text-sm mt-1">Try increasing the relevance slider or sync new messages</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {allMessages.map((msg) => (
        <MessageCard key={msg.id} message={msg} />
      ))}
      {hasNextPage && (
        <div className="flex justify-center py-4">
          <button
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="px-5 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md disabled:opacity-50 transition-colors"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
