interface RelevanceSliderProps {
  value: number; // 0-100: 0 = most filtered, 100 = show everything
  onChange: (value: number) => void;
}

export function RelevanceSlider({ value, onChange }: RelevanceSliderProps) {
  const label =
    value === 100
      ? 'All messages'
      : value === 0
        ? 'Top 5% only'
        : `Top ${Math.round(5 + (value / 100) * 95)}%`;

  return (
    <div className="px-3 py-4 border-t border-white/10">
      <div className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">
        Relevance
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 h-2">
          <div className="absolute inset-0 rounded-full bg-white/10" />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-green-400/80"
            style={{ width: `${value}%` }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md border-2 border-green-400 pointer-events-none"
            style={{ left: `calc(${value}% - 7px)` }}
          />
        </div>
      </div>
      <div className="text-xs text-white/50 mt-2 text-center">{label}</div>
    </div>
  );
}
