import type { NicheStorage, ScenarioData, ScenarioStorage } from '../types'
import { createDefaultStorage } from './niches'

const STORAGE_KEY = 'unit-economics-calculator:v2'
const LEGACY_KEY = 'unit-economics-calculator:v1'

export interface PersistedState {
  auto: boolean
  niches: NicheStorage
}

function isScenarioData(value: unknown): value is ScenarioData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<ScenarioData>
  return typeof v.inputs === 'object' && v.inputs !== null
}

function normalizeScenario(
  stored: unknown,
  fallback: ScenarioData,
): ScenarioData {
  if (!isScenarioData(stored)) return fallback
  return {
    ...stored,
    cohortOverrides:
      stored.cohortOverrides ?? fallback.cohortOverrides,
    cohortBaseUsers: stored.cohortBaseUsers ?? null,
  }
}

function normalize(raw: string | null): PersistedState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState> | NicheStorage
    const defaults = createDefaultStorage()

    const nichesRaw =
      'niches' in parsed ? parsed.niches : (parsed as NicheStorage)
    const auto = 'auto' in parsed ? Boolean(parsed.auto) : false

    const merged = {} as NicheStorage
    for (const nicheKey of Object.keys(defaults) as (keyof NicheStorage)[]) {
      const storedNiche = (nichesRaw as Record<string, unknown>)?.[
        nicheKey
      ] as Record<string, unknown> | undefined
      const nicheDefaults = defaults[nicheKey]
      const mergedNiche = {} as ScenarioStorage
      for (const scenarioKey of Object.keys(
        nicheDefaults,
      ) as (keyof ScenarioStorage)[]) {
        mergedNiche[scenarioKey] = normalizeScenario(
          storedNiche?.[scenarioKey],
          nicheDefaults[scenarioKey],
        )
      }
      merged[nicheKey] = mergedNiche
    }
    return { auto, niches: merged }
  } catch {
    return null
  }
}

export function loadState(): PersistedState {
  const state =
    normalize(localStorage.getItem(STORAGE_KEY)) ??
    normalize(localStorage.getItem(LEGACY_KEY))
  return state ?? { auto: false, niches: createDefaultStorage() }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // localStorage недоступен — работаем без сохранения
  }
}

export function clearState(): PersistedState {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // ignore
  }
  return { auto: false, niches: createDefaultStorage() }
}
