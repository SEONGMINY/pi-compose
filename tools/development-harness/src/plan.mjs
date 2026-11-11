/** Task/Step/Run: steps are verifiable milestones, not necessarily agent sessions. */
export function validatePlan(steps) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) throw Error('Expected 1..8 steps');
  const known = new Set();
  for (const step of steps) {
    if (!step || typeof step.id !== 'string' || !/^[a-z][a-z0-9-]{0,35}$/.test(step.id) || known.has(step.id)) throw Error('Invalid/duplicate step id');
    if (typeof step.goal !== 'string' || !step.goal.trim() || step.goal.length > 500) throw Error('Invalid step goal');
    if (!Array.isArray(step.ac) || step.ac.length === 0 || !step.ac.every(x => typeof x === 'string' && x.trim() && x.length <= 300)) throw Error('Acceptance criteria required');
    if (!Array.isArray(step.dependencies) || step.dependencies.some(x => !known.has(x))) throw Error('Dependencies must refer to earlier steps');
    known.add(step.id);
  }
  return steps;
}

/** Avoid artificial decomposition. Explicit user enumeration is the only deterministic split. */
export function initialPlan(prompt) {
  const lines = prompt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const items = lines.map(s => s.match(/^(?:\d+[.)]|[-*])\s+(.+)$/)?.[1]).filter(Boolean);
  if (items.length >= 2 && items.length <= 6) {
    return validatePlan(items.map((goal, i) => ({ id:`step-${i+1}`, goal, ac:[`Confirm the stated outcome for: ${goal}`], dependencies:i ? [`step-${i}`] : [] })));
  }
  return validatePlan([{id:'delivery', goal:prompt.trim().slice(0,450), ac:['Verify the requested behavior against project-specific acceptance criteria'],dependencies:[]}]);
}

export function mergeRefinedPlan(existing, refined, startedRunCount) {
  if (startedRunCount > 0) throw Error('Do not rewrite the plan after implementation started; use a scope-change event');
  return validatePlan(refined);
}
