import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useFeed } from '../hooks/useFeed';
import { useChannels } from '../hooks/useChannels';
import { TopBar } from '../components/TopBar';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { FeedList } from '../components/FeedList';

export function FeedPage() {
  const { user } = useAuth();
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const {
    data: channelsData,
    isLoading: channelsLoading,
  } = useChannels(user?.workspace_id);

  const {
    data: feedData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading: feedLoading,
  } = useFeed({
    channelId: selectedChannelId ?? undefined,
    userId: user?.id,
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopBar workspaceId={user?.workspace_id} />
      <div className="flex flex-1 overflow-hidden">
        <ChannelSidebar
          channels={channelsData ?? []}
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
          isLoading={channelsLoading}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {feedLoading ? (
            <div className="text-center py-16 text-gray-400">Loading messages...</div>
          ) : (
            <FeedList
              pages={feedData?.pages ?? []}
              hasNextPage={!!hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onLoadMore={() => fetchNextPage()}
            />
          )}
        </main>
      </div>
    </div>
  );
}
