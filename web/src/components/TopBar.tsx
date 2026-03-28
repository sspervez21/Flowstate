import { useAuth } from '../hooks/useAuth';
import { useSyncStatus } from '../hooks/useSyncStatus';
import { apiFetch } from '../lib/api';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function TopBar() {
  const { user, logout } = useAuth();
  const { data: syncStatus } = useSyncStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await apiFetch('slack-sync');
      // Refetch all data after sync completes
      await queryClient.invalidateQueries();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const lastSynced = syncStatus?.lastSyncedAt
    ? new Date(syncStatus.lastSyncedAt).toLocaleTimeString()
    : 'Never';

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Flowstate</h1>
        <span className="text-xs text-gray-400">
          Last synced: {lastSynced}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </button>
        {user && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{user.display_name}</span>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
