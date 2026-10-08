import Tooltip from './Tooltip'

interface MetricInputProps {
  label: string
  tooltip: string
  value: number
  error?: string
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}

export default function MetricInput({
  label,
  tooltip,
  value,
  error,
  suffix,
  disabled = false,
  onChange,
}: MetricInputProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label
          className={`text-sm font-medium ${disabled ? 'text-slate-500' : 'text-slate-300'}`}
        >
          {label}
        </label>
        <Tooltip text={tooltip} />
        {disabled && (
          <span className="rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-cyan-400">
            авто
          </span>
        )}
      </div>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          disabled={disabled}
          value={Number.isNaN(value) ? '' : value}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          className={`w-full rounded-lg border bg-slate-950/60 px-3 py-2 font-mono text-sm outline-none transition-all placeholder:text-slate-600 ${
            disabled
              ? 'cursor-not-allowed border-slate-700 text-slate-500'
              : error
                ? 'border-red-500 bg-red-500/10 text-red-400'
                : 'border-cyan-500/30 text-slate-100 focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.25)]'
          }`}
          aria-invalid={Boolean(error)}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
