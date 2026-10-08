import { useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { Download, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { InputErrors, InputKey, Inputs, Metrics } from '../types'
import {
  INPUT_LABELS,
  INPUT_TOOLTIPS,
  formatCurrency,
  formatNumber,
} from '../utils/formulas'
import CohortTable from './CohortTable'
import MetricInput from './MetricInput'
import Tooltip from './Tooltip'

const INPUT_FIELDS: { key: InputKey; suffix?: string }[] = [
  { key: 'userAcquisition' },
  { key: 'conversionRate', suffix: '%' },
  { key: 'averagePrice' },
  { key: 'averagePaymentCount' },
  { key: 'margin', suffix: '%' },
  { key: 'acquisitionCosts' },
  { key: 'fixedCosts' },
]

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{
    value?: number | string
    payload?: { name?: string; color?: string }
  }>
}

function ChartTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const color = entry.payload?.color ?? '#22d3ee'
  return (
    <div className="rounded-lg border border-cyan-500/40 bg-slate-900/95 px-3 py-2 shadow-[0_0_15px_rgba(34,211,238,0.25)] backdrop-blur-sm">
      <p className="text-xs text-slate-400">{entry.payload?.name}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold" style={{ color }}>
        {formatCurrency(Number(entry.value))}
      </p>
    </div>
  )
}

interface MetricCardDef {
  key: keyof Metrics
  label: string
  hint: string
  money?: boolean
}

const METRIC_CARDS: MetricCardDef[] = [
  {
    key: 'buyers',
    label: 'Buyers',
    hint: 'Число покупателей — уникальные пользователи, совершившие оплату. Формула: User Acquisition × (C1 / 100).',
  },
  {
    key: 'cpUser',
    label: 'CPUser',
    hint: 'Cost per User — стоимость привлечения одного пользователя. Формула: Acq. Costs / User Acquisition.',
    money: true,
  },
  {
    key: 'cac',
    label: 'CAC',
    hint: 'Customer Acquisition Cost — стоимость привлечения одного покупателя. Формула: Acq. Costs / Buyers.',
    money: true,
  },
  {
    key: 'cogsUnit',
    label: 'COGS (unit)',
    hint: 'Себестоимость единицы продажи. Формула: Av. Price × (1 − Margin / 100).',
    money: true,
  },
  {
    key: 'amppu',
    label: 'AMPPU',
    hint: 'Average Margin per Paying User — средняя маржа на платящего пользователя. Формула: Av. Price × (Margin / 100) × APC.',
    money: true,
  },
  {
    key: 'revenue',
    label: 'Revenue',
    hint: 'Выручка за период. Формула: Av. Price × Buyers × Av. Payment Count.',
    money: true,
  },
  {
    key: 'grossProfit',
    label: 'Gross Profit',
    hint: 'Валовая прибыль до вычета расходов на привлечение. Формула: Buyers × AMPPU (эквивалент Revenue − Total COGS).',
    money: true,
  },
  {
    key: 'operationalProfit',
    label: 'Operational Profit',
    hint: 'Операционная прибыль до постоянных издержек. Формула: Gross Profit − Acq. Costs.',
    money: true,
  },
  {
    key: 'netProfit',
    label: 'Net Profit',
    hint: 'Чистая прибыль. Формула: Operational Profit − Fix Costs.',
    money: true,
  },
  {
    key: 'ltv',
    label: 'LTV',
    hint: 'LifeTime Value — маржа с привлечённого пользователя за всё время жизни. Формула: (C1 / 100) × CLTV, где CLTV — маржа платящего пользователя за всю жизнь (= AMPPU). LTV должен быть больше CAC для здоровой экономики.',
    money: true,
  },
]

interface DashboardProps {
  inputs: Inputs
  errors: InputErrors
  metrics: Metrics | null
  nicheLabel: string
  scenarioLabel: string
  readOnly: boolean
  retentionMonth1: number
  cohortOverrides: (number | null)[]
  cohortBaseUsers: number | null
  onInputChange: (key: InputKey, value: number) => void
  onRetentionMonth1Change: (value: number) => void
  onCohortOverrideChange: (month: number, value: number | null) => void
  onResetCohortCurve: () => void
  onCohortBaseUsersChange: (value: number | null) => void
}

export default function Dashboard({
  inputs,
  errors,
  metrics,
  nicheLabel,
  scenarioLabel,
  readOnly,
  retentionMonth1,
  cohortOverrides,
  cohortBaseUsers,
  onInputChange,
  onRetentionMonth1Change,
  onCohortOverrideChange,
  onResetCohortCurve,
  onCohortBaseUsersChange,
}: DashboardProps) {
  const [exporting, setExporting] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)
  const [reportDate, setReportDate] = useState('')

  const chartData = useMemo(() => {
    if (!metrics) return []
    return [
      { name: 'Revenue', value: metrics.revenue, color: '#22d3ee' },
      { name: 'Gross Profit', value: metrics.grossProfit, color: '#a78bfa' },
      {
        name: 'Net Profit',
        value: metrics.netProfit,
        color: metrics.netProfit >= 0 ? '#34d399' : '#ef4444',
      },
    ]
  }, [metrics])

  // Unit Ratio = CLTV / CAC, где CLTV = AMPPU (знаменатели одинаковы: на платящего пользователя)
  const unitRatio = metrics && metrics.cac > 0 ? metrics.amppu / metrics.cac : null
  type HealthLevel = 'great' | 'ok' | 'bad'
  const health: HealthLevel | null =
    unitRatio === null
      ? null
      : unitRatio > 3
        ? 'great'
        : unitRatio >= 1
          ? 'ok'
          : 'bad'
  const healthColorClass =
    health === 'great'
      ? 'text-emerald-400'
      : health === 'ok'
        ? 'text-yellow-400'
        : 'text-red-400'
  const healthBorderClass =
    health === 'great'
      ? 'border-emerald-500/50 shadow-[0_0_15px_rgba(52,211,153,0.2)]'
      : health === 'ok'
        ? 'border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]'
        : health === 'bad'
          ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
          : ''
  const healthLabel =
    health === 'great' ? 'Здорово' : health === 'ok' ? 'Терпимо' : 'Убыточно'

  const handleExportPdf = async () => {
    if (!reportRef.current || exporting) return
    setExporting(true)
    setReportDate(new Date().toLocaleDateString('ru-RU'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    try {
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: '#0f172a',
        scale: 2,
      })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 8
      const imgWidth = pageWidth - margin * 2
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      let heightLeft = imgHeight
      let position = margin

      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight)
      heightLeft -= pageHeight - margin * 2

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + margin
        pdf.addPage()
        pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight)
        heightLeft -= pageHeight - margin * 2
      }
      pdf.save(`unit-economics-${nicheLabel}-${scenarioLabel}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  const formatMetric = (def: MetricCardDef) => {
    if (!metrics) return '—'
    const value = metrics[def.key]
    if (!Number.isFinite(value)) return '—'
    return def.money ? formatCurrency(value) : formatNumber(value, 0)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
            Unit Economics Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {nicheLabel} · сценарий: {scenarioLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={exporting}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_10px_rgba(8,145,178,0.5)] transition-all hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Скачать PDF-отчет
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="relative z-20 rounded-xl border border-cyan-500/30 bg-slate-900/80 p-4 backdrop-blur-sm sm:p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
            Входные данные
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {INPUT_FIELDS.map(({ key, suffix }) => (
              <MetricInput
                key={key}
                label={INPUT_LABELS[key]}
                tooltip={INPUT_TOOLTIPS[key]}
                value={inputs[key]}
                error={errors[key]}
                suffix={suffix}
                disabled={readOnly}
                onChange={(v) => onInputChange(key, v)}
              />
            ))}
          </div>
        </section>

        <section className="relative z-10 rounded-xl border border-cyan-500/30 bg-slate-900/80 p-4 backdrop-blur-sm sm:p-6 lg:col-span-3">
          <h2 className="mb-4 text-lg font-semibold text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
            Рассчитанные метрики
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {METRIC_CARDS.map((def) => (
              <div
                key={def.key}
                className="rounded-lg border border-slate-700/60 bg-slate-950/60 p-3"
              >
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-xs text-slate-400">
                    {def.label}
                  </p>
                  <Tooltip text={def.hint} />
                </div>
                <p className="mt-1 truncate font-mono text-sm font-semibold text-cyan-400">
                  {formatMetric(def)}
                </p>
              </div>
            ))}
          </div>
          {!metrics && (
            <p className="mt-4 rounded-lg border border-red-500 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              Исправьте ошибки во входных данных — расчёты временно
              недоступны.
            </p>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-4 backdrop-blur-sm sm:p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
            Revenue vs Profit
          </h2>
          <div className="h-72 w-full">
            {metrics ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat('ru-RU', {
                        notation: 'compact',
                      }).format(v)
                    }
                  />
                  <RechartsTooltip
                    cursor={{ fill: 'rgba(34, 211, 238, 0.07)' }}
                    content={<ChartTooltip />}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Нет данных для графика
              </div>
            )}
          </div>
        </section>

        <section
          className={`rounded-xl border bg-slate-900/80 p-4 backdrop-blur-sm sm:p-6 ${
            health === null ? 'border-slate-700' : healthBorderClass
          }`}
        >
          <h2 className="mb-4 text-lg font-semibold text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
            LTV vs CAC
          </h2>
          {unitRatio === null ? (
            <p className="font-mono text-3xl text-slate-500">—</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-3">
                <span className={`font-mono text-4xl font-bold ${healthColorClass}`}>
                  {unitRatio.toFixed(2)}
                </span>
                <span
                  className={`flex items-center gap-1 text-sm font-medium ${healthColorClass}`}
                >
                  {health === 'bad' ? (
                    <TrendingDown className="h-4 w-4" />
                  ) : (
                    <TrendingUp className="h-4 w-4" />
                  )}
                  {healthLabel}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Значение &gt; 3 означает масштабируемую и здоровую экономику
              </p>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex justify-between border-b border-slate-800 pb-1.5">
                  <span className="text-slate-400">CLTV (AMPPU)</span>
                  <span className="text-cyan-400">
                    {formatCurrency(metrics!.amppu)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">CAC</span>
                  <span className="text-cyan-400">
                    {formatCurrency(metrics!.cac)}
                  </span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                {health === 'great'
                  ? 'Пожизненная маржа платящего пользователя более чем втрое превышает стоимость привлечения — можно масштабировать.'
                  : health === 'ok'
                    ? 'Маржа покрывает стоимость привлечения, но запас невелик — следите за ростом CAC.'
                    : 'Стоимость привлечения выше CLTV — при масштабировании бизнес будет уходить в убыток.'}
              </p>
            </div>
          )}
        </section>
      </div>

      <CohortTable
        retentionMonth1={retentionMonth1}
        overrides={cohortOverrides}
        defaultBaseUsers={inputs.userAcquisition}
        baseUsersOverride={cohortBaseUsers}
        disabled={readOnly}
        onRetentionMonth1Change={onRetentionMonth1Change}
        onOverrideChange={onCohortOverrideChange}
        onResetCurve={onResetCohortCurve}
        onBaseUsersChange={onCohortBaseUsersChange}
      />

      <div
        ref={reportRef}
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          width: 794,
          boxSizing: 'border-box',
          padding: 40,
          backgroundColor: '#020617',
          color: '#e2e8f0',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ borderBottom: '2px solid #22d3ee', paddingBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#22d3ee' }}>
            Unit Economics Report
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#94a3b8' }}>
            {nicheLabel} · сценарий: {scenarioLabel}
            {reportDate && ` · ${reportDate}`}
          </p>
        </div>

        <h2 style={{ margin: '24px 0 12px', fontSize: 16, color: '#22d3ee' }}>
          Входные данные
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 32, rowGap: 6, fontSize: 13 }}>
          {INPUT_FIELDS.map(({ key }) => (
            <div
              key={key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid #1e293b',
                paddingBottom: 4,
              }}
            >
              <span style={{ color: '#94a3b8' }}>{INPUT_LABELS[key]}</span>
              <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>
                {Number.isNaN(inputs[key]) ? '—' : formatNumber(inputs[key])}
              </span>
            </div>
          ))}
        </div>

        <h2 style={{ margin: '24px 0 12px', fontSize: 16, color: '#22d3ee' }}>
          Рассчитанные метрики
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 32, rowGap: 6, fontSize: 13 }}>
          {METRIC_CARDS.map((def) => (
            <div
              key={def.key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid #1e293b',
                paddingBottom: 4,
              }}
            >
              <span style={{ color: '#94a3b8' }}>{def.label}</span>
              <span style={{ fontFamily: 'monospace', color: '#22d3ee' }}>
                {formatMetric(def)}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <span style={{ fontSize: 13, color: '#94a3b8' }}>Unit Ratio (CLTV / CAC):</span>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: 22,
              fontWeight: 700,
              color:
                health === 'great'
                  ? '#34d399'
                  : health === 'ok'
                    ? '#facc15'
                    : '#ef4444',
            }}
          >
            {unitRatio === null ? '—' : unitRatio.toFixed(2)}
          </span>
          <span
            style={{
              fontSize: 13,
              color:
                health === 'great'
                  ? '#34d399'
                  : health === 'ok'
                    ? '#facc15'
                    : '#ef4444',
            }}
          >
            {unitRatio === null ? '' : healthLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
