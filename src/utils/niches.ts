import type {
  Inputs,
  NicheId,
  NicheStorage,
  ScenarioData,
  ScenarioId,
} from '../types'

export interface NicheOption {
  id: NicheId
  label: string
  icon: string
  defaults: Inputs
  defaultRetentionMonth1: number
}

export const NICHES: NicheOption[] = [
  {
    id: 'mobile-app',
    label: 'Мобильное приложение',
    icon: 'smartphone',
    defaults: {
      userAcquisition: 10000,
      conversionRate: 3,
      averagePrice: 299,
      averagePaymentCount: 1.4,
      margin: 70,
      acquisitionCosts: 250000,
      fixedCosts: 400000,
    },
    defaultRetentionMonth1: 40,
  },
  {
    id: 'saas',
    label: 'SaaS',
    icon: 'cloud',
    defaults: {
      userAcquisition: 5000,
      conversionRate: 8,
      averagePrice: 1490,
      averagePaymentCount: 6,
      margin: 85,
      acquisitionCosts: 600000,
      fixedCosts: 1200000,
    },
    defaultRetentionMonth1: 75,
  },
  {
    id: 'e-commerce',
    label: 'E-commerce',
    icon: 'shopping-cart',
    defaults: {
      userAcquisition: 20000,
      conversionRate: 2,
      averagePrice: 3500,
      averagePaymentCount: 1.8,
      margin: 45,
      acquisitionCosts: 700000,
      fixedCosts: 900000,
    },
    defaultRetentionMonth1: 25,
  },
]

export interface ScenarioOption {
  id: ScenarioId
  label: string
  factor: number
}

export const SCENARIOS: ScenarioOption[] = [
  { id: 'pessimistic', label: 'Пессимистичный', factor: 0.7 },
  { id: 'realistic', label: 'Реалистичный', factor: 1 },
  { id: 'optimistic', label: 'Оптимистичный', factor: 1.3 },
]

export const DEFAULT_SCENARIO: ScenarioId = 'realistic'

function applyFactor(inputs: Inputs, factor: number): Inputs {
  return {
    userAcquisition: Math.round(inputs.userAcquisition * factor),
    conversionRate: Math.min(100, +(inputs.conversionRate * factor).toFixed(1)),
    averagePrice: Math.round(inputs.averagePrice * (factor > 1 ? 1.1 : factor < 1 ? 0.9 : 1)),
    averagePaymentCount: +(
      inputs.averagePaymentCount * (factor > 1 ? 1.1 : factor < 1 ? 0.9 : 1)
    ).toFixed(1),
    margin: inputs.margin,
    acquisitionCosts: Math.round(
      inputs.acquisitionCosts * (factor > 1 ? 1.2 : factor < 1 ? 0.8 : 1),
    ),
    fixedCosts: inputs.fixedCosts,
  }
}

export function defaultScenarioData(
  niche: NicheOption,
  scenario: ScenarioOption,
): ScenarioData {
  return {
    inputs: applyFactor(niche.defaults, scenario.factor),
    retentionMonth1: Math.min(
      100,
      Math.round(niche.defaultRetentionMonth1 * scenario.factor),
    ),
    cohortOverrides: Array(7).fill(null),
    cohortBaseUsers: null,
  }
}

export function createDefaultStorage(): NicheStorage {
  const storage = {} as NicheStorage
  for (const niche of NICHES) {
    storage[niche.id] = {} as Record<ScenarioId, ScenarioData>
    for (const scenario of SCENARIOS) {
      storage[niche.id][scenario.id] = defaultScenarioData(niche, scenario)
    }
  }
  return storage
}

export function getNiche(id: NicheId): NicheOption {
  return NICHES.find((n) => n.id === id) ?? NICHES[0]
}
