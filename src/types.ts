export type NicheId = 'mobile-app' | 'saas' | 'e-commerce'

export type ScenarioId = 'pessimistic' | 'realistic' | 'optimistic'

export type InputKey =
  | 'userAcquisition'
  | 'conversionRate'
  | 'averagePrice'
  | 'averagePaymentCount'
  | 'margin'
  | 'acquisitionCosts'
  | 'fixedCosts'

export interface Inputs {
  userAcquisition: number
  conversionRate: number
  averagePrice: number
  averagePaymentCount: number
  margin: number
  acquisitionCosts: number
  fixedCosts: number
}

export interface Metrics {
  buyers: number
  cpUser: number
  cac: number
  cogsUnit: number
  amppu: number
  revenue: number
  grossProfit: number
  operationalProfit: number
  netProfit: number
  ltv: number
}

export type MetricKey = keyof Metrics

export interface InputRule {
  min: number
  max: number
  required: boolean
}

export type InputRules = Record<InputKey, InputRule>

export type InputErrors = Partial<Record<InputKey, string>>

export interface ScenarioData {
  inputs: Inputs
  retentionMonth1: number
  cohortOverrides: (number | null)[]
  cohortBaseUsers: number | null
}

export type ScenarioStorage = Record<ScenarioId, ScenarioData>

export type NicheStorage = Record<NicheId, ScenarioStorage>

export interface CohortRow {
  month: number
  retention: number
  churn: number
  activeUsers: number
}
