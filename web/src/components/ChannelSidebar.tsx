import type { Channel } from '../lib/types';

interface ChannelSidebarProps {
  channels: Channel[];
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string | null) => void;
  isLoading: boolean;
}

export function ChannelSidebar({
  channels,
  selectedChannelId,
  onSelectChannel,
  isLoading,
}: ChannelSidebarProps) {
  if (isLoading) {
    return (
      <div className="w-56 flex-shrink-0 border-r border-gray-200 p-4">
        <p className="text-sm text-gray-400">Loading channels...</p>
      </div>
    );
  }

  return (
    <div className="w-56 flex-shrink-0 border-r border-gray-200 overflow-y-auto">
      <div className="p-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Channels
        </h3>
        <button
          onClick={() => onSelectChannel(null)}
          className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
            selectedChannelId === null
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          All channels
        </button>
        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onSelectChannel(channel.id)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
              selectedChannelId === channel.id
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            # {channel.name}
          </button>
        ))}
      </div>
    </div>
  );
}
