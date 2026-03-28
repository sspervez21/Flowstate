import type { Message } from '../lib/types';
import { MessageCard } from './MessageCard';
import { LoadMoreButton } from './LoadMoreButton';

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
      <div className="text-center py-16 text-gray-500">
        <p className="text-lg">No messages yet</p>
        <p className="text-sm mt-1">Hit "Sync Now" to pull messages from Slack</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {allMessages.map((msg) => (
        <MessageCard key={msg.id} message={msg} />
      ))}
      {hasNextPage && (
        <LoadMoreButton
          isLoading={isFetchingNextPage}
          onClick={onLoadMore}
        />
      )}
    </div>
  );
}
