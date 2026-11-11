/** Planning is a measurement aid, not an agent/session orchestrator. */
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

/** Numbered requirements are not necessarily sequential implementation steps.
 * Only explicit phase/step headings authorize deterministic decomposition.
 * Anything more semantic needs a bounded planner with schema validation.
 */
export function initialPlan(prompt) {
  const lines = prompt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const phases = lines.map(s => s.match(/^(?:(?:phase|step)\s*\d+|\d+\s*단계)\s*[:.)-]\s*(.+)$/i)?.[1]).filter(Boolean);
  if (phases.length >= 2 && phases.length <= 6) {
    return validatePlan(phases.map((goal, i) => ({id:`step-${i+1}`,goal,
      ac:[`Check the explicitly requested outcome for: ${goal}`],dependencies:i?[`step-${i}`]:[]})));
  }
  return validatePlan([{id:'delivery',goal:prompt.trim().slice(0,450),
    ac:['Verify requested behavior against project-specific acceptance criteria'],dependencies:[]}]);
}

/** A conservative boundary heuristic. Never claim this is semantic certainty.
 * Returning 'new' for ambiguous requests avoids conflating unrelated work.
 */
export function classifyFollowup(prompt) {
  const s=prompt.trim();
  if (/^(?:이제\s*(?:다른|새로운)|새로운\s*(?:기능|작업)|다른\s*(?:기능|작업)|(?:next|new|another)\s+(?:task|feature|project)\b)/i.test(s))
    return {intent:'new',basis:'explicit-topic-switch'};
  if (/^(?:아직|여전히|안\s*돼|안\s*되|작동\s*안|동작\s*안|실패|오류|에러|수정이\s*안|still\s+(?:fails|broken)|(?:it|this)\s+(?:still|doesn.t))/i.test(s))
    return {intent:'rework',basis:'explicit-failure-followup'};
  if (/^(?:계속|이어서|추가로|위\s*(?:작업|내용)|방금\s*(?:수정|작업)|그\s*(?:작업|기능)|해당\s*(?:작업|기능)|(?:continue|also|additionally|follow[ -]?up)\b)/i.test(s))
    return {intent:'continue',basis:'explicit-continuation'};
  return {intent:'new',basis:'ambiguous-default-new'};
}

export function mergeRefinedPlan(existing,refined,startedRunCount) {
  if (startedRunCount > 0) throw Error('Do not rewrite the plan after implementation started; use a scope-change event');
  return validatePlan(refined);
}
