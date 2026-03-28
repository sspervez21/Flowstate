interface LoadMoreButtonProps {
  isLoading: boolean;
  onClick: () => void;
}

export function LoadMoreButton({ isLoading, onClick }: LoadMoreButtonProps) {
  return (
    <div className="flex justify-center py-4">
      <button
        onClick={onClick}
        disabled={isLoading}
        className="px-6 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Loading...' : 'Show more messages'}
      </button>
    </div>
  );
}
