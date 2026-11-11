/** Empirical forecasts for internal maintenance tasks.
 * Deterministic; never invents data when the comparable cohort is too small.
 * Observed token counts are lower bounds until every contributing run is covered.
 */
import { listTasks, validateForecast } from './core.mjs';

const LEVELS = [['p30', 0.30], ['p50', 0.50], ['p80', 0.80]];
const DEFAULT_MIN = 8;
function finiteNonnegative(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0; }
function quantiles(values, transform = (v) => v) {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(LEVELS.map(([key, p]) => [key,
    transform(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)])]));
}

/** Historical cohorts must share category, environment and time accounting basis.
 * No forecast is emitted until both time and registered-token samples are adequate.
 */
export function suggestForecast(tasks, { kind, environment, elapsedBasis = 'wall-clock', minSamples = DEFAULT_MIN } = {}) {
  if (typeof kind !== 'string' || !kind.trim() || typeof environment !== 'string' || !environment.trim())
    throw new Error('Forecast requires an explicit task kind and execution environment');
  if (!['wall-clock', 'runner-monotonic'].includes(elapsedBasis))
    throw new Error('Unsupported elapsed-time accounting basis');
  if (!Number.isInteger(minSamples) || minSamples < 4 || minSamples > 100)
    throw new Error('minSamples must be between 4 and 100');
  const cohort = tasks.filter(t => t.state === 'completed' && t.kind === kind &&
    (t.environment ?? 'unknown') === environment && t.measurement?.elapsedBasis === elapsedBasis);
  const times = cohort.map(t => t.measurement?.elapsedMs / 60000).filter(finiteNonnegative);
  const observedTokens = cohort.map(t => t.measurement?.tokens?.totalTokens).filter(finiteNonnegative);
  const counts = { cohort: cohort.length, minutes: times.length, tokens: observedTokens.length };
  const missing = Object.entries({ minutes: times.length, tokens: observedTokens.length })
    .filter(([, n]) => n < minSamples).map(([dimension]) => dimension);
  const basis = { kind, environment, elapsedBasis, minSamples,
    sampleCount: counts, method: 'nearest-rank-empirical-quantile',
    tokenCoverage: 'registered-only; may underestimate true use',
    probabilityCalibration: 'not-verified',
    note: 'These are empirical samples, not independently calibrated 30/50/80 completion probabilities.' };
  if (missing.length) return { ready: false, missing, ...basis, forecast: null };
  const forecast = { minutes: quantiles(times, Math.ceil), tokens: quantiles(observedTokens, Math.ceil) };
  validateForecast(forecast);
  return { ready: true, missing: [], ...basis, forecast };
}

export async function suggestHistoricalForecast(dir, opts) {
  return suggestForecast(await listTasks(dir), opts);
}
