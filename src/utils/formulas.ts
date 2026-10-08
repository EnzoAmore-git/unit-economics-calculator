import type {
  CohortRow,
  InputErrors,
  InputKey,
  InputRules,
  Inputs,
  Metrics,
} from '../types'

export const INPUT_RULES: InputRules = {
  userAcquisition: { min: 1, max: Number.MAX_SAFE_INTEGER, required: true },
  conversionRate: { min: 0, max: 100, required: true },
  averagePrice: { min: 0, max: Number.MAX_SAFE_INTEGER, required: true },
  averagePaymentCount: { min: 0, max: Number.MAX_SAFE_INTEGER, required: true },
  margin: { min: 0, max: 100, required: true },
  acquisitionCosts: { min: 0, max: Number.MAX_SAFE_INTEGER, required: true },
  fixedCosts: { min: 0, max: Number.MAX_SAFE_INTEGER, required: true },
}

export const INPUT_LABELS: Record<InputKey, string> = {
  userAcquisition: 'User Acquisition',
  conversionRate: 'Conv. user to buyer',
  averagePrice: 'Av. Price',
  averagePaymentCount: 'Av. Payment Count',
  margin: 'Margin',
  acquisitionCosts: 'Acq. Costs',
  fixedCosts: 'Fix Costs',
}

export const INPUT_TOOLTIPS: Record<InputKey, string> = {
  userAcquisition:
    'Количество уникальных пользователей, привлеченных за расчетный период.',
  conversionRate:
    'Конверсия из пользователя в покупателя. Формула: buyers / users. Допустимый диапазон: 0–100%.',
  averagePrice:
    'Средний чек — сумма, которую платит пользователь за одну покупку.',
  averagePaymentCount:
    'Среднее число покупок на одного платящего пользователя за период.',
  margin:
    'Маржинальность — доля выручки, остающаяся после вычета себестоимости (COGS). Формула: (Revenue − COGS) / Revenue. Диапазон: 0–100%.',
  acquisitionCosts:
    'Сумма масштабируемых расходов на привлечение пользователей до первой оплаты.',
  fixedCosts:
    'Постоянные издержки бизнеса, которые можно ограничить сверху.',
}

export function validateInput(key: InputKey, value: number): string | null {
  const rule = INPUT_RULES[key]
  if (Number.isNaN(value)) {
    return rule.required ? 'Поле обязательно для заполнения' : null
  }
  if (value < rule.min) {
    if (key === 'userAcquisition') return 'Должно быть больше 0'
    if (rule.min === 0) return 'Значение не может быть отрицательным'
    return `Минимум: ${rule.min}`
  }
  if (value > rule.max) {
    return `Максимум: ${rule.max}`
  }
  return null
}

export function validateInputs(inputs: Inputs): InputErrors {
  const errors: InputErrors = {}
  for (const key of Object.keys(INPUT_RULES) as InputKey[]) {
    const error = validateInput(key, inputs[key])
    if (error) errors[key] = error
  }
  return errors
}

export function hasErrors(errors: InputErrors): boolean {
  return Object.keys(errors).length > 0
}

// Buyers = User Acquisition * (C1 / 100)
export function calcBuyers(i: Inputs): number {
  return i.userAcquisition * (i.conversionRate / 100)
}

// CPUser = Acq. Costs / User Acquisition
export function calcCpUser(i: Inputs): number {
  return i.acquisitionCosts / i.userAcquisition
}

// CAC = Acq. Costs / Buyers
export function calcCac(i: Inputs): number {
  const buyers = calcBuyers(i)
  return buyers > 0 ? i.acquisitionCosts / buyers : NaN
}

// COGS (unit) = Av. Price * (1 - Margin / 100)
export function calcCogsUnit(i: Inputs): number {
  return i.averagePrice * (1 - i.margin / 100)
}

// AMPPU = Av. Price * (Margin / 100) * Av. Payment Count
export function calcAmppu(i: Inputs): number {
  return i.averagePrice * (i.margin / 100) * i.averagePaymentCount
}

// Revenue = Av. Price * Buyers * Av. Payment Count
export function calcRevenue(i: Inputs): number {
  return i.averagePrice * calcBuyers(i) * i.averagePaymentCount
}

// Gross Profit = Buyers * AMPPU (эквивалент Revenue - Total COGS)
export function calcGrossProfit(i: Inputs): number {
  return calcBuyers(i) * calcAmppu(i)
}

// Profit (Operational) = Gross Profit - Acq. Costs
export function calcOperationalProfit(i: Inputs): number {
  return calcGrossProfit(i) - i.acquisitionCosts
}

// Net Profit = Profit (Operational) - Fix Costs
export function calcNetProfit(i: Inputs): number {
  return calcOperationalProfit(i) - i.fixedCosts
}

// LTV = (C1 / 100) * CLTV, где CLTV = AMPPU (маржа платящего пользователя за всю жизнь)
export function calcLtv(i: Inputs): number {
  return (i.conversionRate / 100) * calcAmppu(i)
}

export function calcMetrics(inputs: Inputs): Metrics {
  return {
    buyers: calcBuyers(inputs),
    cpUser: calcCpUser(inputs),
    cac: calcCac(inputs),
    cogsUnit: calcCogsUnit(inputs),
    amppu: calcAmppu(inputs),
    revenue: calcRevenue(inputs),
    grossProfit: calcGrossProfit(inputs),
    operationalProfit: calcOperationalProfit(inputs),
    netProfit: calcNetProfit(inputs),
    ltv: calcLtv(inputs),
  }
}

export const COHORT_MONTHS = 7
export const RETENTION_DECAY = 0.65

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export const AUTO_FACTOR_PESSIMISTIC = 0.8
export const AUTO_FACTOR_OPTIMISTIC = 1.2

// Автосценарий: каждый вход пересчитывается от Реалистичного ±20%
export function deriveInputs(base: Inputs, factor: number): Inputs {
  const round1 = (n: number) => Math.round(n * 10) / 10
  return {
    userAcquisition: Math.max(1, Math.round(base.userAcquisition * factor)),
    conversionRate: clamp(round1(base.conversionRate * factor), 0, 100),
    averagePrice: Math.max(0, Math.round(base.averagePrice * factor)),
    averagePaymentCount: Math.max(0, round1(base.averagePaymentCount * factor)),
    margin: clamp(round1(base.margin * factor), 0, 100),
    acquisitionCosts: Math.max(0, Math.round(base.acquisitionCosts * factor)),
    fixedCosts: Math.max(0, Math.round(base.fixedCosts * factor)),
  }
}

// retention(m) = retention(m-1) * decay, кроме Month 0 (всегда 100%) и Month 1 (ввод пользователя)
export function calcCohortCurve(
  retentionMonth1: number,
  overrides: (number | null)[],
): CohortRow[] {
  const rows: CohortRow[] = []
  let retention = 100
  for (let month = 0; month < COHORT_MONTHS; month++) {
    if (month === 1) retention = retentionMonth1
    else if (month > 1) retention = retention * RETENTION_DECAY

    const override = overrides[month]
    const finalRetention = month === 0 ? 100 : (override ?? retention)
    const clamped = Math.min(100, Math.max(0, finalRetention))

    rows.push({
      month,
      retention: clamped,
      churn: 100 - clamped,
      activeUsers: 0,
    })
  }
  return rows
}

export function fillCohortActiveUsers(
  rows: CohortRow[],
  buyers: number,
): CohortRow[] {
  return rows.map((row) => ({
    ...row,
    activeUsers: buyers * (row.retention / 100),
  }))
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
