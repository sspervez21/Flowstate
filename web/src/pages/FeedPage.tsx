import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useFeed } from '../hooks/useFeed';
import { useChannels } from '../hooks/useChannels';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { useScoreMessages } from '../hooks/useScoring';
import { apiFetch } from '../lib/api';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { FeedList } from '../components/FeedList';
import { DebugPanel } from '../components/DebugPanel';
import { RulesPanel } from '../components/RulesPanel';

type Tab = 'feed' | 'debug' | 'rules';

export function FeedPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('feed');
  const [relevance, setRelevance] = useState(100); // 100 = show everything
  const [isSyncing, setIsSyncing] = useState(false);
  const [visibleChannelIds, setVisibleChannelIds] = useState<Set<string> | null>(null);

  // Convert slider value (0-100) to threshold (0.95-0)
  const threshold = 0.95 * (100 - relevance) / 100;

  const { data: rawChannels, isLoading: channelsLoading } = useChannels();
  const { data: syncStatus } = useSyncStatus();
  const scoreMessages = useScoreMessages();

  const {
    data: feedData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading: feedLoading,
  } = useFeed({
    channelId: selectedChannelId ?? undefined,
    threshold,
  });

  // When viewing "All channels", derive which channels have visible messages
  useEffect(() => {
    if (selectedChannelId !== null) return;
    const messages = feedData?.pages?.flat() ?? [];
    if (messages.length > 0) {
      setVisibleChannelIds(new Set(messages.map((m) => m.channel_id)));
    } else if (!feedLoading) {
      setVisibleChannelIds(new Set());
    }
  }, [selectedChannelId, feedData, feedLoading]);

  // Dynamic channel list: only show channels with messages after filtering
  const channelsData = useMemo(() => {
    const withMessages = rawChannels?.filter((c) => c.last_message_at != null) ?? [];
    // When slider is at 100% (no threshold), show all channels with synced messages
    if (threshold <= 0) return withMessages;
    // When threshold is active, only show channels that have visible messages
    if (!visibleChannelIds) return withMessages;
    return withMessages.filter((c) => visibleChannelIds.has(c.id));
  }, [rawChannels, threshold, visibleChannelIds]);

  // If selected channel disappears from the list, reset to All channels
  useEffect(() => {
    if (selectedChannelId && channelsData.length > 0) {
      const stillVisible = channelsData.some((c) => c.id === selectedChannelId);
      if (!stillVisible) setSelectedChannelId(null);
    }
  }, [selectedChannelId, channelsData]);

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await apiFetch('slack-sync');
      await queryClient.invalidateQueries();
      // Auto-score after sync
      scoreMessages.mutate();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'feed', label: 'Feed' },
    { key: 'debug', label: 'Debug' },
    { key: 'rules', label: 'Rules' },
  ];

  const selectedChannel = selectedChannelId
    ? channelsData?.find((c) => c.id === selectedChannelId)
    : null;

  const headerTitle = selectedChannel ? `# ${selectedChannel.name}` : 'All channels';

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Top bar - minimal */}
      <header className="h-10 flex items-center justify-end px-4 border-b border-gray-200 bg-[#350D36] text-white/80 text-sm flex-shrink-0">
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-white/60">{user.display_name}</span>
            <button
              onClick={logout}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <ChannelSidebar
          channels={channelsData ?? []}
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
          isLoading={channelsLoading}
          relevance={relevance}
          onRelevanceChange={setRelevance}
          isSyncing={isSyncing || scoreMessages.isPending}
          onSync={handleSync}
          lastSynced={syncStatus?.lastSyncedAt ?? null}
        />

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Channel header + tabs */}
          <div className="border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center justify-between px-5 py-2">
              <h2 className="text-lg font-bold text-gray-900">{headerTitle}</h2>
              {scoreMessages.isPending && (
                <span className="text-xs text-gray-400 animate-pulse">
                  Scoring messages...
                </span>
              )}
            </div>
            <div className="flex gap-0 px-5">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'feed' && (
              feedLoading ? (
                <div className="text-center py-16 text-gray-400">Loading messages...</div>
              ) : (
                <FeedList
                  pages={feedData?.pages ?? []}
                  hasNextPage={!!hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  onLoadMore={() => fetchNextPage()}
                />
              )
            )}

            {activeTab === 'debug' && (
              <DebugPanel pages={feedData?.pages ?? []} isScoring={scoreMessages.isPending} />
            )}

            {activeTab === 'rules' && (
              <RulesPanel />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
