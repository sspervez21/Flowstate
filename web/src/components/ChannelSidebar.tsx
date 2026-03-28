import type { Channel } from '../lib/types';
import { RelevanceSlider } from './RelevanceSlider';

interface ChannelSidebarProps {
  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string | null) => void;
  isLoading: boolean;
  relevance: number;
  onRelevanceChange: (value: number) => void;
  isSyncing: boolean;
  onSync: () => void;
  lastSynced: string | null;
}

export function ChannelSidebar({
  channels,
  selectedChannelId,
  onSelectChannel,
  isLoading,
  relevance,
  onRelevanceChange,
  isSyncing,
  onSync,
  lastSynced,
}: ChannelSidebarProps) {
  const syncLabel = lastSynced
    ? new Date(lastSynced).toLocaleTimeString()
    : 'Never';

  return (
    <div className="w-64 flex-shrink-0 bg-[#3F0E40] text-white flex flex-col h-full">
      {/* Workspace header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">Flowstate</h1>
      </div>

      {/* Sync status */}
      <div className="px-3 py-2 border-b border-white/10">
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="w-full text-left px-2 py-1.5 rounded text-sm text-white/70 hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          {isSyncing ? 'Syncing...' : `Sync Now`}
        </button>
        <div className="px-2 text-[10px] text-white/30 mt-0.5">
          Last synced: {syncLabel}
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-3 mb-1">
          <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
            Channels
          </span>
        </div>
        {isLoading ? (
          <div className="px-4 py-2 text-sm text-white/40">Loading...</div>
        ) : (
          <>
            <button
              onClick={() => onSelectChannel(null)}
              className={`w-full text-left px-4 py-1 text-sm transition-colors ${
                selectedChannelId === null
                  ? 'bg-[#1164A3] text-white font-medium'
                  : 'text-white/70 hover:bg-white/10'
              }`}
            >
              All channels
            </button>
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => onSelectChannel(channel.id)}
                className={`w-full text-left px-4 py-1 text-sm transition-colors ${
                  selectedChannelId === channel.id
                    ? 'bg-[#1164A3] text-white font-medium'
                    : 'text-white/70 hover:bg-white/10'
                }`}
              >
                <span className="text-white/40 mr-1">#</span>
                {channel.name}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Relevance slider */}
      <RelevanceSlider value={relevance} onChange={onRelevanceChange} />
    </div>
  );
}
