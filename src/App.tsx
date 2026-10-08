import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useSearchParams,
} from 'react-router-dom'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import Dashboard from './components/Dashboard'
import type {
  InputErrors,
  InputKey,
  NicheId,
  ScenarioData,
  ScenarioId,
} from './types'
import {
  AUTO_FACTOR_OPTIMISTIC,
  AUTO_FACTOR_PESSIMISTIC,
  calcMetrics,
  deriveInputs,
  hasErrors,
  validateInputs,
} from './utils/formulas'
import { DEFAULT_SCENARIO, NICHES, SCENARIOS } from './utils/niches'
import {
  clearState,
  loadState,
  saveState,
  type PersistedState,
} from './utils/storage'

const AUTO_WARNING =
  'Введённые данные Пессимистичного и Оптимистичного сценария будут стёрты и пересчитаны автоматически: Реалистичный ±20%. Продолжить?'

function deriveScenarioData(
  realistic: ScenarioData,
  factor: number,
): ScenarioData {
  return {
    inputs: deriveInputs(realistic.inputs, factor),
    retentionMonth1: Math.min(
      100,
      Math.max(0, Math.round(realistic.retentionMonth1 * factor)),
    ),
    cohortOverrides: Array(7).fill(null),
    cohortBaseUsers: null,
  }
}

function CalculatorApp() {
  const [searchParams, setSearchParams] = useSearchParams()

  const nicheParam = searchParams.get('niche')
  const niche: NicheId = NICHES.some((n) => n.id === nicheParam)
    ? (nicheParam as NicheId)
    : 'mobile-app'

  const scenarioParam = searchParams.get('scenario')
  const scenario: ScenarioId = SCENARIOS.some((s) => s.id === scenarioParam)
    ? (scenarioParam as ScenarioId)
    : DEFAULT_SCENARIO

  const [state, setState] = useState<PersistedState>(() => loadState())
  const [showAutoWarning, setShowAutoWarning] = useState(false)

  useEffect(() => {
    saveState(state)
  }, [state])

  const realisticData = state.niches[niche].realistic
  const storedData = state.niches[niche][scenario]
  const scenarioData =
    state.auto && scenario !== 'realistic'
      ? deriveScenarioData(
          realisticData,
          scenario === 'pessimistic'
            ? AUTO_FACTOR_PESSIMISTIC
            : AUTO_FACTOR_OPTIMISTIC,
        )
      : storedData
  const readOnly = state.auto && scenario !== 'realistic'

  const errors: InputErrors = useMemo(
    () => validateInputs(scenarioData.inputs),
    [scenarioData.inputs],
  )

  const metrics = useMemo(
    () => (hasErrors(errors) ? null : calcMetrics(scenarioData.inputs)),
    [errors, scenarioData.inputs],
  )

  const setParam = useCallback(
    (key: 'niche' | 'scenario', value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(key, value)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const patchScenario = useCallback(
    (nicheId: NicheId, scenarioId: ScenarioId, patch: Partial<ScenarioData>) => {
      setState((prev) => {
        const nicheData = { ...prev.niches[nicheId] }
        nicheData[scenarioId] = {
          ...nicheData[scenarioId],
          ...patch,
        }
        // Авторежим: правки Реалистичного сразу пересчитывают Пессимистичный и Оптимистичный
        if (prev.auto) {
          nicheData.pessimistic = deriveScenarioData(
            nicheData.realistic,
            AUTO_FACTOR_PESSIMISTIC,
          )
          nicheData.optimistic = deriveScenarioData(
            nicheData.realistic,
            AUTO_FACTOR_OPTIMISTIC,
          )
        }
        return {
          ...prev,
          niches: { ...prev.niches, [nicheId]: nicheData },
        }
      })
    },
    [],
  )

  const handleInputChange = useCallback(
    (key: InputKey, value: number) => {
      patchScenario(niche, scenario, {
        inputs: { ...scenarioData.inputs, [key]: value },
      })
    },
    [niche, scenario, patchScenario, scenarioData.inputs],
  )

  const handleRetentionChange = useCallback(
    (value: number) => {
      patchScenario(niche, scenario, { retentionMonth1: value })
    },
    [niche, scenario, patchScenario],
  )

  const handleCohortOverrideChange = useCallback(
    (month: number, value: number | null) => {
      const overrides = [...scenarioData.cohortOverrides]
      overrides[month] = value
      patchScenario(niche, scenario, { cohortOverrides: overrides })
    },
    [niche, scenario, patchScenario, scenarioData.cohortOverrides],
  )

  const handleResetCohortCurve = useCallback(() => {
    patchScenario(niche, scenario, { cohortOverrides: Array(7).fill(null) })
  }, [niche, scenario, patchScenario])

  const handleCohortBaseUsersChange = useCallback(
    (value: number | null) => {
      patchScenario(niche, scenario, { cohortBaseUsers: value })
    },
    [niche, scenario, patchScenario],
  )

  const applyAuto = useCallback((auto: boolean) => {
    setState((prev) => {
      const niches = { ...prev.niches }
      // при включении и выключении храним производные значения, чтобы они не рассинхронизировались с Реалистичным
      for (const n of NICHES) {
        const nicheData = { ...niches[n.id] }
        nicheData.pessimistic = deriveScenarioData(
          nicheData.realistic,
          AUTO_FACTOR_PESSIMISTIC,
        )
        nicheData.optimistic = deriveScenarioData(
          nicheData.realistic,
          AUTO_FACTOR_OPTIMISTIC,
        )
        niches[n.id] = nicheData
      }
      return { ...prev, auto, niches }
    })
  }, [])

  const handleAutoToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        if (state.auto) return
        // предупреждение нужно только если сценарии заполнялись вручную
        const realistic = state.niches[niche].realistic
        const expectedPess = JSON.stringify(
          deriveScenarioData(realistic, AUTO_FACTOR_PESSIMISTIC),
        )
        const expectedOpt = JSON.stringify(
          deriveScenarioData(realistic, AUTO_FACTOR_OPTIMISTIC),
        )
        const manualData =
          JSON.stringify(state.niches[niche].pessimistic) !== expectedPess ||
          JSON.stringify(state.niches[niche].optimistic) !== expectedOpt
        if (manualData) {
          setShowAutoWarning(true)
        } else {
          applyAuto(true)
        }
      } else {
        applyAuto(false)
      }
    },
    [state, niche, applyAuto],
  )

  const confirmAuto = useCallback(() => {
    setShowAutoWarning(false)
    applyAuto(true)
  }, [applyAuto])

  const handleResetAll = useCallback(() => {
    if (!window.confirm('Сбросить все данные до значений по умолчанию?')) {
      return
    }
    setState(clearState())
  }, [])

  const nicheLabel = NICHES.find((n) => n.id === niche)?.label ?? ''
  const scenarioLabel =
    SCENARIOS.find((s) => s.id === scenario)?.label ?? 'Реалистичный'

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-cyan-500/30 bg-slate-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-mono text-lg font-bold tracking-wider text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              ⚡ UNIT ECONOMICS CALCULATOR
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="niche-select"
                  className="text-xs text-slate-400"
                >
                  Ниша
                </label>
                <select
                  id="niche-select"
                  value={niche}
                  onChange={(e) => setParam('niche', e.target.value)}
                  className="rounded-lg border border-cyan-500/30 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 outline-none transition-all hover:border-cyan-400/60 focus:border-cyan-400 focus:shadow-[0_0_10px_rgba(34,211,238,0.25)]"
                >
                  {NICHES.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleResetAll}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition-all hover:border-red-500 hover:bg-red-500/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Сбросить все данные
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Сценарий прогноза">
            {SCENARIOS.map((s) => {
              const active = s.id === scenario
              const locked = state.auto && s.id !== 'realistic'
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParam('scenario', s.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-all ${
                    active
                      ? 'bg-cyan-600 font-semibold text-white shadow-[0_0_10px_rgba(8,145,178,0.5)]'
                      : 'border border-cyan-500/30 text-slate-400 hover:border-cyan-400/60 hover:text-cyan-400'
                  } ${locked && !active ? 'opacity-70' : ''}`}
                >
                  {s.label}
                </button>
              )
            })}
            {state.auto && (
              <span className="ml-1 self-center rounded border border-cyan-500/40 px-1.5 py-0.5 text-[10px] font-medium uppercase text-cyan-400">
                авто-расчёт вкл
              </span>
            )}
          </div>

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={state.auto}
              onChange={(e) => handleAutoToggle(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-cyan-500"
            />
            Авто
            <span className="text-xs text-slate-500">
              (Реалистичный ±20%)
            </span>
          </label>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Dashboard
          inputs={scenarioData.inputs}
          errors={errors}
          metrics={metrics}
          nicheLabel={nicheLabel}
          scenarioLabel={scenarioLabel}
          readOnly={readOnly}
          retentionMonth1={scenarioData.retentionMonth1}
          cohortOverrides={scenarioData.cohortOverrides}
          cohortBaseUsers={scenarioData.cohortBaseUsers}
          onInputChange={handleInputChange}
          onRetentionMonth1Change={handleRetentionChange}
          onCohortOverrideChange={handleCohortOverrideChange}
          onResetCohortCurve={handleResetCohortCurve}
          onCohortBaseUsersChange={handleCohortBaseUsersChange}
        />
      </main>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        Данные хранятся локально в вашем браузере (localStorage)
      </footer>

      {showAutoWarning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="auto-warning-title"
        >
          <div className="w-full max-w-md rounded-xl border border-amber-500/40 bg-slate-900 p-6 shadow-[0_0_25px_rgba(245,158,11,0.2)]">
            <div className="mb-3 flex items-center gap-2 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              <h2 id="auto-warning-title" className="text-base font-semibold">
                Включить авто-расчёт?
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              {AUTO_WARNING}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Пессимистичный и Оптимистичный сценарии станут доступны только
              для чтения.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAutoWarning(false)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 transition-all hover:border-slate-400 hover:text-slate-100"
              >
                <X className="h-4 w-4" />
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmAuto}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_10px_rgba(8,145,178,0.5)] transition-all hover:bg-cyan-500"
              >
                Включить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<CalculatorApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
