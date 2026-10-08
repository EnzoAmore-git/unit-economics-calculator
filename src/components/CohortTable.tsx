import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, RefreshCcw, RotateCcw, X } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatNumber } from '../utils/formulas'
import { NICHES } from '../utils/niches'
import Tooltip from './Tooltip'

interface CohortTableProps {
  // legacy-пропсы (передаются из Dashboard)
  retentionMonth1: number
  overrides: (number | null)[]
  defaultBaseUsers: number | null
  baseUsersOverride: number | null
  disabled?: boolean
  onRetentionMonth1Change: (value: number) => void
  onOverrideChange: (month: number, value: number | null) => void
  onResetCurve: () => void
  onBaseUsersChange: (value: number | null) => void
  // пропсы дашборда
  currentMonth?: number
  retentionM1?: number
  baseUA?: number
  cohortUA?: number[]
  cohortOverrides?: Record<string, number>
  avPrice?: number
  avPaymentCount?: number
  margin?: number
  cac?: number
  // новые пропсы (п. 12)
  granularity?: Granularity
  intensityMode?: IntensityMode
  rollingRetention?: boolean
  selectedCohorts?: number[]
  onCohortSelect?: (index: number) => void
}

type Granularity = 'month' | 'week' | 'day'
type IntensityMode = 'percent' | 'absolute'
type MetricMode = 'revenue' | 'customers'
type DisplayMode = 'cohort' | 'total' | 'absolute'

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const COHORT_COUNT = 7
const STORE_KEY = 'cohort-data'
const MONTH_OPTIONS = [12, 15, 24]
const MAX_SELECTED = 3
const CHART_COLORS = ['#22d3ee', '#34d399', '#a78bfa']

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'month', label: 'MONTH' },
  { value: 'week', label: 'WEEK' },
  { value: 'day', label: 'DAY' },
]

const INTENSITY_OPTIONS: { value: IntensityMode; label: string }[] = [
  { value: 'percent', label: '% RETENTION' },
  { value: 'absolute', label: 'ABSOLUTE USERS' },
]

const DISPLAY_OPTIONS: { value: DisplayMode; label: string }[] = [
  { value: 'cohort', label: '% OF COHORT' },
  { value: 'total', label: '% OF TOTAL' },
  { value: 'absolute', label: 'ABSOLUTE' },
]

const FALLBACK = NICHES[0].defaults

function monthLabel(idx: number): string {
  const m = ((idx % 12) + 12) % 12
  const year = 2026 + Math.floor(idx / 12)
  return `${MONTH_ABBR[m]} ${year}`
}

function prefixFor(g: Granularity): string {
  return g === 'month' ? 'M' : g === 'week' ? 'W' : 'D'
}

function colsCountFor(g: Granularity, monthsCount: number): number {
  if (g === 'week') return 12
  if (g === 'day') return 31
  return monthsCount
}

function periodFactor(g: Granularity): number {
  if (g === 'day') return 30.4
  if (g === 'week') return 4.35
  return 1
}

// Retention_n = Retention_1 × (1/√n)
function autoRetention(retM1: number, col: number): number {
  if (col === 0) return 100
  if (!Number.isFinite(retM1)) return NaN
  return Math.min(100, Math.max(0, retM1 * (1 / Math.sqrt(col))))
}

// RollingRetention_n = max(Retention_1 ... Retention_n)
function rollingCurve(ret: (number | null)[]): (number | null)[] {
  let max = NaN
  return ret.map((v, idx) => {
    if (v === null) return null
    if (idx === 0) return v
    if (!Number.isFinite(v)) return v
    max = Number.isFinite(max) ? Math.max(max, v) : v
    return max
  })
}

function heat(pct: number): { bg: string; text: string } {
  if (pct >= 90) return { bg: 'bg-emerald-600', text: 'text-white' }
  if (pct >= 70) return { bg: 'bg-teal-500', text: 'text-white' }
  if (pct >= 50) return { bg: 'bg-cyan-400', text: 'text-slate-900' }
  if (pct >= 30) return { bg: 'bg-yellow-500', text: 'text-slate-900' }
  if (pct >= 15) return { bg: 'bg-orange-500', text: 'text-white' }
  return { bg: 'bg-rose-600', text: 'text-white' }
}

// ABSOLUTE USERS: плавный градиент slate-900 → emerald-600
function absColorStyle(pct: number): CSSProperties {
  const a = Math.max(0, Math.min(1, pct / 100))
  const r = Math.round(15 + (5 - 15) * a)
  const g = Math.round(23 + (150 - 23) * a)
  const b = Math.round(42 + (105 - 42) * a)
  return { backgroundColor: `rgb(${r}, ${g}, ${b})` }
}

function fmtPct(v: number): string {
  return `${formatNumber(v, 1)}%`
}

function fmtUsers(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  return formatNumber(v, 0)
}

function fmtMoney(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  return `$${formatNumber(v, 0)}`
}

function fmtMoneyFull(v: number): string {
  if (!Number.isFinite(v)) return '—'
  return `$${formatNumber(v, 0)}`
}

interface CellTipProps {
  text: ReactNode
  className?: string
  onClick?: () => void
  children: ReactNode
}

function CellTip({ text, className, onClick, children }: CellTipProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      top: rect.bottom + 6,
      left: Math.min(
        Math.max(rect.left + rect.width / 2, 140),
        window.innerWidth - 140,
      ),
    })
  }
  const hide = () => setPos(null)

  useEffect(() => {
    if (!pos) return
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  return (
    <div
      ref={ref}
      className={className}
      onClick={() => {
        setPos(null)
        onClick?.()
      }}
      onTouchStart={(e) => {
        // на мобильных: первый тап — тултип, второй — действие
        if (!pos) {
          e.preventDefault()
          show()
        }
      }}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[100] rounded-lg border border-cyan-500/40 bg-slate-900 px-3 py-2 font-mono text-slate-300 shadow-[0_0_15px_rgba(34,211,238,0.3)]"
            style={{
              top: pos.top,
              left: pos.left,
              transform: 'translateX(-50%)',
              width: 240,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </div>
  )
}

function TipLines({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col" style={{ fontSize: 12, lineHeight: 1.6 }}>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  )
}

interface StoredData {
  ua?: (number | null)[]
  uaOverrides?: Record<number, number>
  overrides?: Record<string, number>
  granularity?: Granularity
  intensityMode?: IntensityMode
  rollingRetention?: boolean
  selectedCohorts?: number[]
}

function loadStored(): Required<
  Pick<
    StoredData,
    'overrides' | 'granularity' | 'intensityMode' | 'rollingRetention' | 'selectedCohorts'
  >
> & { ua: (number | null)[] } {
  const base = {
    ua: [] as (number | null)[],
    overrides: {} as Record<string, number>,
    granularity: 'month' as Granularity,
    intensityMode: 'percent' as IntensityMode,
    rollingRetention: false,
    selectedCohorts: [] as number[],
  }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as StoredData

    if (parsed.uaOverrides && typeof parsed.uaOverrides === 'object') {
      base.ua = Array.from({ length: COHORT_COUNT }, (_, i) => {
        const v = parsed.uaOverrides?.[i]
        return typeof v === 'number' && Number.isFinite(v) ? v : null
      })
    } else if (Array.isArray(parsed.ua)) {
      base.ua = parsed.ua.map((v) =>
        typeof v === 'number' && Number.isFinite(v) ? v : null,
      )
    }

    if (parsed.overrides && typeof parsed.overrides === 'object') {
      for (const [key, val] of Object.entries(parsed.overrides)) {
        if (typeof val === 'number' && Number.isFinite(val)) {
          base.overrides[key] = val
        }
      }
    }

    if (
      parsed.granularity === 'month' ||
      parsed.granularity === 'week' ||
      parsed.granularity === 'day'
    ) {
      base.granularity = parsed.granularity
    }
    if (parsed.intensityMode === 'percent' || parsed.intensityMode === 'absolute') {
      base.intensityMode = parsed.intensityMode
    }
    if (typeof parsed.rollingRetention === 'boolean') {
      base.rollingRetention = parsed.rollingRetention
    }
    if (Array.isArray(parsed.selectedCohorts)) {
      base.selectedCohorts = parsed.selectedCohorts.filter(
        (i) => Number.isInteger(i) && i >= 0 && i < COHORT_COUNT,
      )
    }
    return base
  } catch {
    return base
  }
}

interface RowData {
  label: string
  ua: number
  value: number
  ret: (number | null)[]
  shown: (number | null)[]
  old: number | null
  active: (number | null)[]
}

export default function CohortTable({
  retentionMonth1,
  defaultBaseUsers,
  baseUsersOverride,
  disabled = false,
  onRetentionMonth1Change,
  onBaseUsersChange,
  currentMonth = 6,
  retentionM1,
  baseUA,
  cohortUA,
  cohortOverrides,
  avPrice,
  avPaymentCount,
  margin,
  cac,
  granularity: granularityProp,
  intensityMode: intensityProp,
  rollingRetention: rollingProp,
  selectedCohorts: selectedProp,
  onCohortSelect,
}: CohortTableProps) {
  const retM1 = retentionM1 ?? retentionMonth1
  const effectiveBase = baseUA ?? baseUsersOverride ?? defaultBaseUsers
  const price = avPrice ?? FALLBACK.averagePrice
  const apc = avPaymentCount ?? FALLBACK.averagePaymentCount
  const marginPct = margin ?? FALLBACK.margin
  const cacValue = cac ?? FALLBACK.acquisitionCosts /
    ((FALLBACK.userAcquisition * FALLBACK.conversionRate) / 100)
  const amppu = price * (marginPct / 100) * apc

  const [metric, setMetric] = useState<MetricMode>('customers')
  const [monthsCount, setMonthsCount] = useState(12)
  const [display, setDisplay] = useState<DisplayMode>('cohort')
  const [month, setMonth] = useState(currentMonth)

  const [stored] = useState(loadStored)
  const [gState, setGState] = useState<Granularity>(stored.granularity)
  const [intensityState, setIntensityState] = useState<IntensityMode>(
    stored.intensityMode,
  )
  const [rollingState, setRollingState] = useState(stored.rollingRetention)
  const [selectedState, setSelectedState] = useState<number[]>(
    stored.selectedCohorts,
  )
  const [chartHidden, setChartHidden] = useState(false)

  const granularity = granularityProp ?? gState
  const intensity = intensityProp ?? intensityState
  const rolling = rollingProp ?? rollingState
  const selected = selectedProp ?? selectedState

  const [ua, setUa] = useState<(number | null)[]>(() =>
    cohortUA
      ? Array.from({ length: COHORT_COUNT }, (_, i) => cohortUA[i] ?? null)
      : stored.ua,
  )
  const [overrides, setOverrides] = useState<Record<string, number>>(() => ({
    ...stored.overrides,
    ...cohortOverrides,
  }))

  const [editing, setEditing] = useState<
    | { kind: 'ret'; row: number; col: number | 'old' }
    | { kind: 'ua'; row: number }
    | null
  >(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    try {
      const uaOverrides: Record<number, number> = {}
      ua.forEach((v, i) => {
        if (v !== null) uaOverrides[i] = v
      })
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          ua,
          uaOverrides,
          overrides,
          granularity,
          intensityMode: intensity,
          rollingRetention: rolling,
          selectedCohorts: selected,
        }),
      )
    } catch {
      // localStorage недоступен
    }
  }, [ua, overrides, granularity, intensity, rolling, selected])

  const prefix = prefixFor(granularity)
  const colsCount = colsCountFor(granularity, monthsCount)
  const headers = useMemo(
    () => Array.from({ length: colsCount }, (_, c) => `${prefix}${c}`),
    [colsCount, prefix],
  )

  const totalUA = useMemo(
    () =>
      Array.from({ length: COHORT_COUNT }, (_, i) => ua[i] ?? effectiveBase ?? 0).reduce(
        (s, v) => s + v,
        0,
      ),
    [ua, effectiveBase],
  )

  const rows: RowData[] = useMemo(() => {
    const factor = periodFactor(granularity)
    const result: RowData[] = []
    for (let i = 0; i < COHORT_COUNT; i++) {
      const rowUA = ua[i] ?? effectiveBase ?? 0
      // треугольник (логика не менялась): прожитые периоды, масштабированные
      // гранулярностью, но не больше числа колонок
      const elapsedBase = 11 - i + (month - 6)
      const maxCol = Math.min(colsCount - 1, Math.round(elapsedBase * factor))
      const ret: (number | null)[] = []
      for (let col = 0; col < colsCount; col++) {
        if (col > maxCol) {
          ret.push(null)
          continue
        }
        const override = overrides[`${i}-${col}`]
        const value =
          override !== undefined
            ? override
            : col === 0
              ? 100
              : autoRetention(retM1, col)
        ret.push(Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : NaN)
      }
      const shown = rolling ? rollingCurve(ret) : ret
      const active = shown.map((v) =>
        v !== null && Number.isFinite(v) ? rowUA * (v / 100) : v === null ? null : 0,
      )
      const oldIdx = granularity === 'day' ? 30 : 11
      const oldOverride = overrides[`${i}-old`]
      const old =
        maxCol >= oldIdx && oldIdx < colsCount
          ? oldOverride !== undefined
            ? oldOverride
            : Number.isFinite(ret[oldIdx] ?? NaN)
              ? Math.min(100, Math.max(0, (ret[oldIdx] as number) * 0.8))
              : NaN
          : null
      result.push({
        label: monthLabel(month - COHORT_COUNT + 1 + i),
        ua: rowUA,
        value: metric === 'revenue' ? rowUA * price * apc : rowUA,
        ret,
        shown,
        old,
        active,
      })
    }
    return result
  }, [
    ua,
    effectiveBase,
    colsCount,
    overrides,
    retM1,
    metric,
    price,
    apc,
    month,
    granularity,
    rolling,
  ])

  const weighted = useMemo(() => {
    const cols: (number | null)[] = []
    for (let col = 0; col < colsCount; col++) {
      let num = 0
      let den = 0
      for (const row of rows) {
        const r = row.ret[col]
        if (r === null || !Number.isFinite(r)) continue
        num += row.ua * r
        den += row.ua
      }
      cols.push(den > 0 ? num / den : null)
    }
    let oldNum = 0
    let oldDen = 0
    for (const row of rows) {
      if (row.old === null || !Number.isFinite(row.old)) continue
      oldNum += row.ua * row.old
      oldDen += row.ua
    }
    return { cols, old: oldDen > 0 ? oldNum / oldDen : null }
  }, [rows, colsCount])

  // п.1 CUMULATIVE LTV: Σ(Weighted_Retention_k × AMPPU) для k=0..n
  const cumulativeLtv = useMemo(() => {
    const res: (number | null)[] = []
    let cum = 0
    let started = false
    for (let col = 0; col < colsCount; col++) {
      const w = weighted.cols[col]
      if (w === null) {
        res.push(started ? cum : null)
        continue
      }
      started = true
      cum += (w / 100) * amppu
      res.push(cum)
    }
    return res
  }, [weighted, amppu, colsCount])

  // п.5 PAYBACK PERIOD: первый период, где накопленная маржа ≥ CAC
  const payback: { idx: number } | 'none' | null = (() => {
    if (!(cacValue > 0)) return null
    const n = Math.min(12, colsCount)
    for (let k = 0; k < n; k++) {
      const v = cumulativeLtv[k]
      if (v === null) break
      if (v >= cacValue) return { idx: k }
    }
    return 'none'
  })()

  const maxActive = useMemo(() => {
    let max = 0
    for (const row of rows) {
      for (const a of row.active) {
        if (a !== null && Number.isFinite(a) && a > max) max = a
      }
    }
    return max
  }, [rows])

  const hasEdits =
    Object.keys(overrides).length > 0 || ua.some((v) => v !== null)

  const resetAll = () => {
    setOverrides({})
    setUa([])
  }

  // п.10 Заполнить по формуле — только пустые (авто) ячейки, ручные не трогаем
  const fillByFormula = () => {
    if (
      !window.confirm(
        'Заполнить все пустые ячейки по формуле? Ручные значения сохранятся.',
      )
    ) {
      return
    }
    setOverrides((prev) => {
      const next = { ...prev }
      rows.forEach((row, i) => {
        row.ret.forEach((v, col) => {
          if (v === null) return
          const key = `${i}-${col}`
          if (prev[key] !== undefined) return
          const val = autoRetention(retM1, col)
          if (Number.isFinite(val)) next[key] = val
        })
        if (row.old !== null && prev[`${i}-old`] === undefined) {
          const oldIdx = granularity === 'day' ? 30 : 11
          const base = row.ret[oldIdx]
          if (base !== null && Number.isFinite(base)) {
            next[`${i}-old`] = Math.min(100, Math.max(0, base * 0.8))
          }
        }
      })
      return next
    })
  }

  // п.2 выделение когорт для сравнения (максимум 3)
  const toggleCohort = (idx: number) => {
    const cur = selectedProp ?? selectedState
    if (cur.includes(idx)) {
      const next = cur.filter((x) => x !== idx)
      if (selectedProp === undefined) setSelectedState(next)
    } else if (cur.length < MAX_SELECTED) {
      const next = [...cur, idx]
      if (selectedProp === undefined) setSelectedState(next)
      setChartHidden(false)
    }
    onCohortSelect?.(idx)
  }

  const displayValue = (
    col: number | 'old',
    row: RowData,
  ): { text: string; colorPct: number } | null => {
    const r = col === 'old' ? row.old : row.shown[col]
    if (r === null) return null
    if (!Number.isFinite(r)) return { text: '—', colorPct: 0 }
    const active = col === 'old' ? row.ua * (r / 100) : (row.active[col] ?? 0)
    const colorPct =
      intensity === 'absolute'
        ? maxActive > 0
          ? (active / maxActive) * 100
          : 0
        : r
    if (display === 'cohort') return { text: fmtPct(r), colorPct }
    if (display === 'total')
      return {
        text: fmtPct(totalUA > 0 ? (active / totalUA) * 100 : 0),
        colorPct,
      }
    const abs = metric === 'revenue' ? active * price * apc : active
    return {
      text: metric === 'revenue' ? fmtMoney(abs) : fmtUsers(abs),
      colorPct,
    }
  }

  const startEdit = (
    kind: 'ret' | 'ua',
    row: number,
    col: number | 'old',
    current: number | null,
  ) => {
    if (disabled) return
    if (kind === 'ret' && col === 0) return
    setDraft(current !== null && Number.isFinite(current) ? String(current) : '')
    setEditing(
      kind === 'ua' ? { kind, row } : { kind, row, col: col as number | 'old' },
    )
  }

  const commitEdit = () => {
    if (!editing) return
    const parsed = parseFloat(draft.replace(',', '.'))
    if (editing.kind === 'ua') {
      setUa((prev) => {
        const next = [...prev]
        next[editing.row] = Number.isFinite(parsed) ? Math.max(0, parsed) : null
        return next
      })
    } else {
      const key = `${editing.row}-${editing.col}`
      setOverrides((prev) => {
        const next = { ...prev }
        if (!Number.isFinite(parsed) || draft.trim() === '') {
          delete next[key]
        } else {
          next[key] = Math.min(100, Math.max(0, parsed))
        }
        return next
      })
    }
    setEditing(null)
  }

  const exportCsv = () => {
    const sep = ';'
    const header = ['Cohort', 'VALUE', ...headers, 'OLD']
    const lines = [header.join(sep)]
    for (const row of rows) {
      const cells = [row.label, String(Math.round(row.value))]
      for (let col = 0; col < colsCount; col++) {
        const d = displayValue(col, row)
        cells.push(d ? d.text : '')
      }
      const old = displayValue('old', row)
      cells.push(old ? old.text : '')
      lines.push(cells.join(sep))
    }
    lines.push(
      [
        'WEIGHTED AVG. RETAINED',
        '',
        ...weighted.cols.map((v) => (v === null ? '' : fmtPct(v))),
        weighted.old === null ? '' : fmtPct(weighted.old),
      ].join(sep),
    )
    lines.push(
      [
        'CUMULATIVE LTV',
        '',
        ...cumulativeLtv.map((v) => (v === null ? '' : fmtMoneyFull(v))),
        '',
      ].join(sep),
    )
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cohort-report.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const retentionError =
    Number.isNaN(retM1) || retM1 < 0 || retM1 > 100
      ? 'Допустимый диапазон: 0–100%'
      : undefined

  // п.2 данные графика сравнения когорт
  const chartData = useMemo(
    () =>
      headers.map((h, col) => {
        const point: Record<string, string | number | null> = { name: h }
        for (const idx of selected) {
          point[`c${idx}`] = rows[idx]?.shown[col] ?? null
        }
        return point
      }),
    [headers, selected, rows],
  )

  const chartVisible = selected.length > 0 && !chartHidden

  // п.11 индикатор здоровья по Retention M3 (W3/D3 по гранулярности)
  const health = useMemo(() => {
    return rows.map((row) => {
      const r = row.ret[3]
      if (r === null || !Number.isFinite(r)) return null
      if (r > 40) return { pct: r, label: 'здорово', cls: 'bg-emerald-400' }
      if (r >= 20) return { pct: r, label: 'норма', cls: 'bg-yellow-400' }
      return { pct: r, label: 'проблема', cls: 'bg-red-400' }
    })
  }, [rows])

  const paybackText =
    payback === null
      ? '—'
      : payback === 'none'
        ? 'Не окупается'
        : `${prefix}${payback.idx}`
  const paybackColor =
    payback === null
      ? 'text-slate-500'
      : payback === 'none' || payback.idx > 12
        ? 'text-red-400'
        : payback.idx >= 6
          ? 'text-yellow-400'
          : 'text-emerald-400'

  const tableKey = `${metric}|${display}|${granularity}|${intensity}`

  return (
    <section className="relative z-10 rounded-xl border border-cyan-500/30 bg-slate-900/80 p-4 backdrop-blur-sm sm:p-6">
      <style>{`@keyframes cohort-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
          Когортный анализ
          {rolling && (
            <RotateCcw
              className="h-3 w-3 text-cyan-400"
              aria-label="Rolling retention активен"
            />
          )}
        </h2>
        <div className="flex flex-wrap gap-2">
          {chartVisible && (
            <button
              type="button"
              onClick={() => setChartHidden(true)}
              className="rounded-lg border border-cyan-500/30 px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-cyan-400 hover:text-cyan-400"
            >
              Скрыть график
            </button>
          )}
          {!disabled && (
            <button
              type="button"
              onClick={fillByFormula}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-cyan-400 hover:text-cyan-400"
            >
              <RefreshCcw className="h-4 w-4" />
              Заполнить по формуле
            </button>
          )}
          {hasEdits && !disabled && (
            <button
              type="button"
              onClick={resetAll}
              className="rounded-lg border border-cyan-500/30 px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-cyan-400 hover:text-cyan-400"
            >
              Сбросить вводы
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-cyan-400 hover:text-cyan-400"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      {/* Панель контролов */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Метрика
          </span>
          <div className="flex rounded-lg border border-slate-700 bg-slate-800/80 p-1">
            {(['revenue', 'customers'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  metric === m
                    ? 'bg-cyan-400 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.4)]'
                    : 'text-slate-300 hover:bg-slate-700/60'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* п.4 ROLLING */}
        <div>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Retention
          </span>
          <button
            type="button"
            onClick={() => {
              if (rollingProp === undefined) setRollingState(!rolling)
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
              rolling
                ? 'border-cyan-400 bg-cyan-400/15 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-cyan-500/50'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <RotateCcw className="h-3 w-3" />
            Rolling
          </button>
        </div>

        {granularity === 'month' && (
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Месяцы
            </span>
            <select
              value={monthsCount}
              onChange={(e) => setMonthsCount(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 outline-none transition-colors hover:border-cyan-500/50 focus:border-cyan-400"
            >
              {MONTH_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} months
                </option>
              ))}
            </select>
          </label>
        )}

        {/* п.3 GRANULARITY */}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Granularity
          </span>
          <select
            value={granularity}
            onChange={(e) => {
              const v = e.target.value as Granularity
              if (granularityProp === undefined) setGState(v)
            }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 outline-none transition-colors hover:border-cyan-500/50 focus:border-cyan-400"
          >
            {GRANULARITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Режим
          </span>
          <select
            value={display}
            onChange={(e) => setDisplay(e.target.value as DisplayMode)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 outline-none transition-colors hover:border-cyan-500/50 focus:border-cyan-400"
          >
            {DISPLAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* п.8 INTENSITY */}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Intensity
          </span>
          <select
            value={intensity}
            onChange={(e) => {
              const v = e.target.value as IntensityMode
              if (intensityProp === undefined) setIntensityState(v)
            }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 outline-none transition-colors hover:border-cyan-500/50 focus:border-cyan-400"
          >
            {INTENSITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Текущий месяц
          </span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 outline-none transition-colors hover:border-cyan-500/50 focus:border-cyan-400"
          >
            {Array.from({ length: 12 }, (_, k) => 6 + k).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>

        {/* п.5 PAYBACK PERIOD */}
        <div className="ml-auto rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Payback Period
          </span>
          <span className={`font-mono text-sm font-semibold ${paybackColor}`}>
            {paybackText}
          </span>
        </div>
      </div>

      {/* Ввод данных */}
      <div className="mb-5 grid max-w-xl gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <label
              className={`text-sm font-medium ${disabled ? 'text-slate-500' : 'text-slate-300'}`}
            >
              Retention Month 1 (%)
            </label>
            <Tooltip text="Базовый retention первого месяца. Пустые ячейки считаются по формуле: Retention_n = Retention_1 × (1/√n). Churn = 100% − Retention." />
          </div>
          <div className="relative">
            <input
              type="number"
              disabled={disabled}
              value={Number.isNaN(retM1) ? '' : retM1}
              onChange={(e) =>
                onRetentionMonth1Change(
                  e.target.value === '' ? NaN : Number(e.target.value),
                )
              }
              className={`w-full rounded-lg border bg-slate-950/60 px-3 py-2 pr-8 font-mono text-sm outline-none transition-all ${
                disabled
                  ? 'cursor-not-allowed border-slate-700 text-slate-500'
                  : retentionError
                    ? 'border-red-500 bg-red-500/10 text-red-400'
                    : 'border-cyan-500/30 text-slate-100 focus:border-cyan-400'
              }`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-500">
              %
            </span>
          </div>
          {retentionError && (
            <p className="mt-1 text-xs text-red-400">{retentionError}</p>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <label
              className={`text-sm font-medium ${disabled ? 'text-slate-500' : 'text-slate-300'}`}
            >
              База пользователей
            </label>
            <Tooltip text="UA по умолчанию для всех когорт. UA каждой когорты можно переопределить отдельно — клик по значению в колонке VALUE." />
          </div>
          <div className="relative">
            <input
              type="number"
              disabled={disabled}
              value={baseUsersOverride ?? defaultBaseUsers ?? ''}
              placeholder={
                defaultBaseUsers !== null ? formatNumber(defaultBaseUsers, 0) : '—'
              }
              onChange={(e) =>
                onBaseUsersChange(
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              className={`w-full rounded-lg border bg-slate-950/60 px-3 py-2 pr-9 font-mono text-sm outline-none transition-all placeholder:text-slate-600 ${
                disabled
                  ? 'cursor-not-allowed border-slate-700 text-slate-500'
                  : baseUsersOverride !== null
                    ? 'border-cyan-400/60 text-cyan-400 focus:border-cyan-400'
                    : 'border-cyan-500/30 text-slate-100 focus:border-cyan-400'
              }`}
            />
            {baseUsersOverride !== null && !disabled && (
              <button
                type="button"
                aria-label="Вернуть значение из вводных данных"
                title="Вернуть значение из вводных данных"
                onClick={() => onBaseUsersChange(null)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition-colors hover:bg-cyan-500/10 hover:text-cyan-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {baseUsersOverride !== null ? 'Ручное значение' : 'Из User Acquisition'}
          </p>
        </div>
      </div>

      {/* Легенда */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
        {intensity === 'percent' ? (
          <>
            {[
              ['bg-emerald-600', '90–100%'],
              ['bg-teal-500', '70–89%'],
              ['bg-cyan-400', '50–69%'],
              ['bg-yellow-500', '30–49%'],
              ['bg-orange-500', '15–29%'],
              ['bg-rose-600', '< 15%'],
              ['bg-slate-800/40', 'будущее'],
            ].map(([cls, label]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded-sm ${cls}`} />
                {label}
              </span>
            ))}
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-slate-900" />0
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: 'rgb(10, 87, 76)' }}
              />
              50% max ({fmtUsers(maxActive / 2)})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-600" />
              max ({fmtUsers(maxActive)})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-slate-800/40" />
              будущее
            </span>
          </>
        )}
      </div>

      {/* Таблица */}
      <div className="-mx-4 max-h-[70vh] overflow-auto px-4 sm:mx-0 sm:px-0">
        <table
          key={tableKey}
          style={{ animation: 'cohort-fade 200ms ease-out' }}
          className="w-full min-w-[1000px] border-separate border-spacing-1 text-xs"
        >
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-40 w-[100px] bg-slate-950 px-1.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Когорта
              </th>
              <th className="sticky left-[100px] top-0 z-40 w-[110px] border-r border-slate-700 bg-slate-950 px-1.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Value
              </th>
              {headers.map((h) => (
                <th
                  key={h}
                  className="sticky top-0 z-30 min-w-[60px] bg-slate-950 px-1.5 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                >
                  {h}
                </th>
              ))}
              <th className="sticky top-0 z-30 min-w-[60px] bg-slate-950 px-1.5 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
                Old
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isSel = selected.includes(i)
              const h = health[i]
              return (
                <tr key={row.label}>
                  <td className="sticky left-0 z-20 bg-slate-900 px-1.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleCohort(i)}
                      title="Сравнить когорту на графике"
                      className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-slate-300 transition-all ${
                        isSel ? 'ring-2 ring-cyan-400' : ''
                      } ${disabled ? '' : 'cursor-pointer hover:text-cyan-300'}`}
                    >
                      {row.label}
                      <CellTip
                        text={
                          h
                            ? `Retention ${prefix}3: ${fmtPct(h.pct)} — ${h.label}`
                            : `Retention ${prefix}3: недоступно`
                        }
                        className="flex items-center"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${h ? h.cls : 'bg-slate-600'}`}
                        />
                      </CellTip>
                    </button>
                  </td>
                  <td className="sticky left-[100px] z-20 border-r border-slate-700 bg-slate-900 px-1.5 py-1.5 text-right">
                    {editing?.kind === 'ua' && editing.row === i ? (
                      <input
                        type="number"
                        min={0}
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className="w-full rounded bg-cyan-400/90 px-1 py-0.5 text-right font-mono text-xs text-slate-950 outline-none ring-2 ring-cyan-400"
                      />
                    ) : (
                      <CellTip
                        text={
                          <TipLines
                            lines={[
                              `UA: ${formatNumber(row.ua, 0)}`,
                              ...(metric === 'revenue'
                                ? [`VALUE: ${fmtMoney(row.value)}`]
                                : []),
                              ...(disabled ? [] : ['Клик — изменить UA']),
                            ]}
                          />
                        }
                        onClick={() => startEdit('ua', i, 'old', row.ua)}
                        className={`rounded px-1 py-0.5 font-mono text-xs ${
                          metric === 'revenue' ? 'text-cyan-300' : 'text-cyan-400'
                        } ${disabled ? '' : 'cursor-pointer hover:bg-cyan-500/10'}`}
                      >
                        {metric === 'revenue' ? fmtMoney(row.value) : fmtUsers(row.value)}
                      </CellTip>
                    )}
                  </td>

                  {row.shown.map((r, col) => {
                    if (r === null) {
                      return (
                        <td
                          key={col}
                          className="min-w-[60px] rounded bg-slate-800/20 p-1.5"
                        />
                      )
                    }
                    const d = displayValue(col, row)
                    const isEditing =
                      editing?.kind === 'ret' &&
                      editing.row === i &&
                      editing.col === col
                    const pct = d?.colorPct ?? 0
                    const absStyle =
                      intensity === 'absolute' ? absColorStyle(pct) : undefined
                    const colors =
                      intensity === 'absolute'
                        ? { bg: '', text: pct >= 50 ? 'text-white' : 'text-slate-400' }
                        : heat(pct)
                    const rawRet = row.ret[col]
                    const active = row.active[col] ?? 0
                    const revenue = active * price * apc
                    const tipLines = [
                      `Retention: ${Number.isFinite(r) ? fmtPct(r) : '—'}`,
                      `Churn: ${Number.isFinite(r) ? fmtPct(100 - r) : '—'}`,
                      `Active Users: ${formatNumber(active, 0)}`,
                      `Revenue: ${fmtMoneyFull(revenue)}`,
                    ]
                    return (
                      <td key={col} className="p-0.5">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            style={absStyle}
                            className={`w-full rounded px-1 py-1 text-center font-mono text-xs outline-none ring-2 ring-white/70 ${colors.bg} ${colors.text}`}
                          />
                        ) : (
                          <CellTip
                            text={<TipLines lines={tipLines} />}
                            onClick={() => startEdit('ret', i, col, rawRet)}
                            className={`min-w-[60px] rounded px-1.5 py-1.5 text-center font-mono transition-all duration-500 ${colors.bg} ${colors.text} ${
                              disabled || col === 0
                                ? ''
                                : 'cursor-pointer hover:scale-[1.04]'
                            }`}
                          >
                            <span style={absStyle} className="block rounded">
                              {d ? d.text : ''}
                            </span>
                          </CellTip>
                        )}
                      </td>
                    )
                  })}

                  <td className="p-0.5">
                    {row.old === null ? (
                      <div className="min-w-[60px] rounded bg-slate-800/20 p-1.5" />
                    ) : editing?.kind === 'ret' &&
                      editing.row === i &&
                      editing.col === 'old' ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className={`w-full rounded px-1 py-1 text-center font-mono text-xs outline-none ring-2 ring-white/70 ${heat(row.old).bg} ${heat(row.old).text}`}
                      />
                    ) : (
                      <CellTip
                        text={
                          <TipLines
                            lines={[
                              `OLD (${prefix}${granularity === 'day' ? 30 : 11} × 0.8): ${
                                Number.isFinite(row.old) ? fmtPct(row.old) : '—'
                              }`,
                              `Active Users: ${formatNumber(
                                row.ua * (Number.isFinite(row.old) ? row.old : 0) / 100,
                                0,
                              )}`,
                            ]}
                          />
                        }
                        onClick={() => startEdit('ret', i, 'old', row.old)}
                        className={`min-w-[60px] rounded px-1.5 py-1.5 text-center font-mono transition-all duration-500 ${heat(
                          row.old,
                        ).bg} ${heat(row.old).text} ${
                          disabled ? '' : 'cursor-pointer hover:scale-[1.04]'
                        }`}
                      >
                        {displayValue('old', row)?.text ?? ''}
                      </CellTip>
                    )}
                  </td>
                </tr>
              )
            })}

            {/* WEIGHTED AVG */}
            <tr>
              <td className="sticky left-0 z-20 border-t-2 border-cyan-500/40 bg-slate-950 px-1.5 py-2 font-mono text-[11px] font-semibold text-cyan-400">
                WEIGHTED AVG.
              </td>
              <td className="sticky left-[100px] z-20 border-t-2 border-r border-cyan-500/40 bg-slate-950 px-1.5 py-2 text-right text-[11px] font-semibold text-cyan-400">
                RETAINED
              </td>
              {weighted.cols.map((v, col) => (
                <td key={col} className="p-0.5">
                  {v === null ? (
                    <div className="rounded bg-slate-800/20 p-1.5" />
                  ) : (
                    <div
                      className={`rounded px-1.5 py-1.5 text-center font-mono text-xs font-semibold transition-all duration-500 ${
                        intensity === 'absolute' ? '' : heat(v).bg
                      }`}
                      style={
                        intensity === 'absolute' ? absColorStyle(v) : undefined
                      }
                    >
                      <span
                        className={
                          intensity === 'absolute'
                            ? v >= 50
                              ? 'text-white'
                              : 'text-slate-400'
                            : heat(v).text
                        }
                      >
                        {fmtPct(v)}
                      </span>
                    </div>
                  )}
                </td>
              ))}
              <td className="p-0.5">
                {weighted.old === null ? (
                  <div className="rounded bg-slate-800/20 p-1.5" />
                ) : (
                  <div
                    className={`rounded px-1.5 py-1.5 text-center font-mono text-xs font-semibold ${
                      intensity === 'absolute' ? '' : heat(weighted.old).bg
                    }`}
                    style={
                      intensity === 'absolute'
                        ? absColorStyle(weighted.old)
                        : undefined
                    }
                  >
                    <span
                      className={
                        intensity === 'absolute'
                          ? weighted.old >= 50
                            ? 'text-white'
                            : 'text-slate-400'
                          : heat(weighted.old).text
                      }
                    >
                      {fmtPct(weighted.old)}
                    </span>
                  </div>
                )}
              </td>
            </tr>

            {/* п.1 CUMULATIVE LTV */}
            <tr>
              <td className="sticky left-0 z-20 border-t border-cyan-500/30 bg-slate-950 px-1.5 py-2 font-mono text-[11px] font-semibold text-cyan-400">
                CUMULATIVE LTV
              </td>
              <td className="sticky left-[100px] z-20 border-t border-r border-cyan-500/30 bg-slate-950 px-1.5 py-2 text-right text-[10px] font-medium text-slate-500">
                AMPPU
              </td>
              {cumulativeLtv.map((v, col) => (
                <td key={col} className="p-0.5">
                  {v === null ? (
                    <div className="rounded bg-slate-800/20 p-1.5" />
                  ) : (
                    <div className="rounded bg-slate-950 px-1.5 py-1.5 text-center font-mono text-xs font-semibold text-cyan-400 transition-all duration-500">
                      {fmtMoneyFull(v)}
                    </div>
                  )}
                </td>
              ))}
              <td className="p-0.5">
                <div className="rounded bg-slate-950 px-1.5 py-1.5 text-center font-mono text-[11px] text-slate-500">
                  {fmtMoneyFull(amppu)}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* п.2/п.6 График сравнения когорт */}
      {chartVisible && (
        <div
          style={{ animation: 'cohort-fade 300ms ease-out' }}
          className="mt-5 rounded-lg border border-cyan-500/20 bg-slate-950/60 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Сравнение когорт — retention %
            </span>
            <span className="text-[11px] text-slate-500">
              выделено {selected.length} из {MAX_SELECTED}
            </span>
          </div>
          <div className="h-[200px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="name"
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                />
                <ChartTooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(34,211,238,0.4)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#22d3ee' }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                {selected.map((idx, k) => (
                  <Line
                    key={idx}
                    type="monotone"
                    dataKey={`c${idx}`}
                    name={rows[idx]?.label ?? `#${idx}`}
                    stroke={CHART_COLORS[k % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Треугольная матрица: когорта показывает только прожитые периоды. Пустая
        ячейка внутри периода — авторасчёт Retention_1 × (1/√n), клик — ручное
        значение. Клик по названию когорты — выделить для сравнения на графике
        (до {MAX_SELECTED}). WEIGHTED AVG — взвешенный retention; CUMULATIVE
        LTV — накопленная маржа (Σ Weighted × AMPPU). Данные сохраняются в
        localStorage.
      </p>
    </section>
  )
}
