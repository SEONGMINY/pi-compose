/** A project-owner-declared acceptance contract. The agent cannot attest its
 * own work: only a harness-controlled check process can produce a receipt.
 * Passing a declared check proves that check, NOT unenumerated product behavior.
 */
const idPattern=/^[a-z][a-z0-9-]{0,35}$/;
export function validateCheckCommand(cmd){
  if(!Array.isArray(cmd)||cmd.length<3||cmd.length>12||cmd[0]!=='npm'||cmd[1]!=='run'||
    !cmd.slice(2).every(x=>typeof x==='string'&&/^[a-zA-Z0-9:_-]+$/.test(x)))
    throw Error('Only declared npm run SCRIPT checks are supported');
  return cmd;
}
export function validateAcceptanceContracts(contracts={}){
  if(!contracts||typeof contracts!=='object'||Array.isArray(contracts)||Object.keys(contracts).length>8)
    throw Error('Invalid acceptance contracts');
  for(const [stepId,entries] of Object.entries(contracts)){
    if(!idPattern.test(stepId)||!Array.isArray(entries)||entries.length<1||entries.length>8)
      throw Error('Invalid acceptance step contract');
    for(const entry of entries){
      if(!entry||typeof entry.criterion!=='string'||!entry.criterion.trim()||entry.criterion.length>300)
        throw Error('Invalid acceptance criterion');
      validateCheckCommand(entry.command);
    }
    if(new Set(entries.map(x=>x.criterion)).size!==entries.length)
      throw Error('Duplicate acceptance criterion');
  }
  return contracts;
}
export function acceptanceForStep(step, contracts){
  const entries=contracts?.[step.id]??[];
  const missing=step.ac.filter(criterion=>!entries.some(x=>x.criterion===criterion));
  const unexpected=entries.filter(x=>!step.ac.includes(x.criterion));
  return {covered:entries.length>0&&missing.length===0&&unexpected.length===0,
    missing,unexpected:unexpected.map(x=>x.criterion),entries};
}
