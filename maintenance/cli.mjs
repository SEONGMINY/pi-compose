#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { analyzePending, calibration, finishTask, listTasks, parseQuantiles, pendingRootCauseReviews, startTask } from './core.mjs';
import { listReviews, reviewPending } from './review.mjs';
import { recordExternalUsage, listExternalUsage } from './usage.mjs';
import { executeImprovement, improvementImpact, listAttempts } from './improve.mjs';
import { suggestHistoricalForecast } from './forecast.mjs';

const usage = `Usage:
  node maintenance/cli.mjs forecast --kind CATEGORY --environment NAME [--elapsed-basis wall-clock|runner-monotonic] [--data-dir DIR]
  node maintenance/cli.mjs start --title TEXT --kind CATEGORY (--time P30,P50,P80 --tokens P30,P50,P80 | --historical) [--session FILE ...] [--environment NAME] [--data-dir DIR]
  node maintenance/cli.mjs finish --id UUID [--state completed|failed|cancelled] [--session FILE ...] [--data-dir DIR]
  node maintenance/cli.mjs run --title TEXT --kind CATEGORY --time P30,P50,P80 --tokens P30,P50,P80 [--session FILE ...] -- COMMAND [ARGS ...]
  node maintenance/cli.mjs usage-add --id UUID --provider chatgpt|codex|claude|other --run-id ID --total-tokens N --provenance provider-export|manual --reference TEXT [--data-dir DIR]
  node maintenance/cli.mjs usage-list --id UUID [--data-dir DIR]
  node maintenance/cli.mjs analyze [--data-dir DIR]
  node maintenance/cli.mjs review [--dry-run] [--max-batches N] [--data-dir DIR]
  node maintenance/cli.mjs improvements [--data-dir DIR]
  node maintenance/cli.mjs improve --id REVIEW_UUID --policy FILE [--dry-run] [--data-dir DIR]
  node maintenance/cli.mjs impact [--data-dir DIR]
  node maintenance/cli.mjs list [--data-dir DIR]

Data defaults to .maintenance/ in the current directory. All session paths must be
explicit: missing tokens remain unknown. Durations use minutes. Example:
  node maintenance/cli.mjs run --title 'Fix bug' --kind bug --time 10,20,45 --tokens 3000,5000,10000 --session /path/to/pi.jsonl -- npm run check`;

function parse(args) {
  const opts = { session: [], 'dry-run': false, historical: false };
  const boundary = args.indexOf('--');
  const command = boundary < 0 ? [] : args.slice(boundary + 1);
  const flags = boundary < 0 ? args : args.slice(0, boundary);
  for (let i = 0; i < flags.length; i++) {
    const item = flags[i];
    if (!item.startsWith('--')) throw new Error(`Unexpected argument ${item}`);
    const name = item.slice(2);
    if (name === 'dry-run' || name === 'historical') { opts[name] = true; continue; }
    if (!['title','kind','time','tokens','session','data-dir','id','state','assumptions','max-batches','environment','provider','run-id','total-tokens','provenance','reference','policy','elapsed-basis'].includes(name)) throw new Error(`Unknown option ${item}`);
    const value = flags[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${item}`);
    if (name === 'session') opts.session.push(value);
    else opts[name] = value;
  }
  return { opts, command };
}

function beginArgs(opts, historical = null) {
  if (opts.historical && (opts.time || opts.tokens)) throw new Error('--historical cannot be combined with manual --time/--tokens');
  return { dir: resolve(opts['data-dir'] ?? '.maintenance'), title: opts.title,
    kind: opts.kind ?? 'other', assumptions: opts.assumptions ?? '', environment: opts.environment ?? 'unknown',
    forecast: historical?.forecast ?? { minutes: parseQuantiles(opts.time, 'time'), tokens: parseQuantiles(opts.tokens, 'tokens') },
    forecastProvenance: historical ? {source:'historical',basis:{kind:historical.kind,environment:historical.environment,elapsedBasis:historical.elapsedBasis,counts:historical.sampleCount,method:historical.method,tokenCoverage:historical.tokenCoverage,calibration:historical.probabilityCalibration}} : {source:'manual'},
    sessions: opts.session };
}

async function resolveHistory(opts, expectedBasis = 'wall-clock') {
  if (!opts.historical) return null;
  if (!opts.kind || !opts.environment) throw new Error('--historical requires explicit --kind and --environment');
  const value = await suggestHistoricalForecast(resolve(opts['data-dir'] ?? '.maintenance'), {
    kind: opts.kind ?? 'other', environment: opts.environment ?? 'unknown',
    elapsedBasis: opts['elapsed-basis'] ?? expectedBasis });
  if (!value.ready) throw new Error(`Insufficient comparable history for ${value.missing.join(', ')}: ${JSON.stringify(value.sampleCount)}; supply manual --time and --tokens`);
  return value;
}

async function run(opts, command) {
  if (!command.length) throw new Error('run requires -- COMMAND');
  const task = await startTask(beginArgs(opts, await resolveHistory(opts,'runner-monotonic')));
  console.error(`[maintenance] Started ${task.id}`);
  const begin = performance.now();
  const outcome = await new Promise((resolveDone) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: process.env, cwd: process.cwd() });
    child.once('error', (error) => resolveDone({ code: 1, signal: null, error: error.message }));
    child.once('close', (code, signal) => resolveDone({ code, signal }));
  });
  const state = outcome.code === 0 ? 'completed' : outcome.signal ? 'cancelled' : 'failed';
  try {
    const finished = await finishTask({ dir: resolve(opts['data-dir'] ?? '.maintenance'), id: task.id, state,
      elapsedMs: performance.now() - begin });
    console.log(JSON.stringify({ taskId: task.id, state, measurement: finished.measurement }, null, 2));
  } catch (error) {
    console.error(`[maintenance] Task ${task.id} is still running because final measurement failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (outcome.error) console.error(`[maintenance] ${outcome.error}`);
  process.exitCode = outcome.code ?? 1;
}

async function main(argv) {
  const [action, ...args] = argv;
  if (!action || action === '--help' || action === 'help') { console.log(usage); return; }
  const { opts, command } = parse(args);
  const dir = resolve(opts['data-dir'] ?? '.maintenance');
  if (action === 'forecast') {
    console.log(JSON.stringify(await suggestHistoricalForecast(dir, {kind:opts.kind, environment:opts.environment,
      elapsedBasis:opts['elapsed-basis'] ?? 'wall-clock'}),null,2));return;
  }
  if (action === 'start') {
    console.log(JSON.stringify(await startTask(beginArgs(opts, await resolveHistory(opts))), null, 2)); return;
  }
  if (action === 'finish') {
    if (!opts.id) throw new Error('--id is required');
    console.log(JSON.stringify(await finishTask({ dir, id: opts.id, state: opts.state, sessions: opts.session }), null, 2)); return;
  }
  if (action === 'run') { await run(opts, command); return; }
  if (action === 'usage-add') {
    if (!opts.id) throw new Error('--id is required');
    console.log(JSON.stringify(await recordExternalUsage({ dir, taskId:opts.id, provider:opts.provider,
      runId:opts['run-id'], totalTokens:Number(opts['total-tokens']),
      provenance:opts.provenance ?? 'manual', reference:opts.reference }),null,2));
    return;
  }
  if (action === 'usage-list') {
    if (!opts.id) throw new Error('--id is required');
    console.log(JSON.stringify(await listExternalUsage(dir,opts.id),null,2)); return;
  }
  if (action === 'review') {
    // Scan all completed tasks before expensive model review; this is idempotent.
    await analyzePending(dir);
    console.log(JSON.stringify(await reviewPending({ dir, dryRun: opts['dry-run'],
      maxBatches: opts['max-batches'] == null ? 1 : Number(opts['max-batches']) }), null, 2));
    return;
  }
  if (action === 'improvements') {
    const reviews = await listReviews(dir);
    const candidates = reviews.filter((r) => r.candidate).map((r) => ({
      reviewId:r.id, taskIds:r.taskIds, signature:r.signature,
      ...r.candidate, assessment:r.assessment, limitations:r.limitations,
    }));
    console.log(JSON.stringify({ candidates, unapproved: candidates.length,
      note:'Proposal queue only; no code edits or Main integration are authorized by these suggestions.' }, null, 2));
    return;
  }
  if (action === 'improve') {
    if (!opts.id || !opts.policy) throw new Error('improve requires --id and --policy');
    const result = await executeImprovement({repo:process.cwd(),dir,reviewId:opts.id,
      policyFile:opts.policy,dryRun:opts['dry-run']});
    console.log(JSON.stringify(result,null,2));
    if (result.state === 'blocked') process.exitCode = 1;
    return;
  }
  if (action === 'impact') {
    console.log(JSON.stringify({attempts:await listAttempts(dir),impact:await improvementImpact(dir)},null,2));return;
  }
  if (action === 'list') {
    const tasks = await listTasks(dir);
    console.log(JSON.stringify(tasks.map(({ id, title, kind, state, startedAt, endedAt }) => ({ id, title, kind, state, startedAt, endedAt })), null, 2));
    return;
  }
  if (action === 'analyze') {
    const analyzed = await analyzePending(dir);
    console.log(JSON.stringify({ newlyTriaged: analyzed, pendingRootCauseReviews: await pendingRootCauseReviews(dir), calibration: calibration(await listTasks(dir)) }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${action}\n${usage}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`[maintenance] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
