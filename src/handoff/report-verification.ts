/**
 * Preserve an explicit Work report of test/verification execution state.
 * This returns a verbatim excerpt, never a fabricated "tests passed" assertion.
 * Source quotes remain Work-reported until independently checked.
 */
export function findVerificationReportQuote(report:string):string|undefined {
  const lines=report.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  const mentions=/(?:테스트|검증|빌드|타입\s*체크|미실행|실행하지|실패|통과|\btests?\b|\btypecheck\b|\blint\b|\bbuild\b|\bCI\b)/i;
  const unsafe=/(?:password|private.?key|api.?key|secret|credential|authorization|bearer)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
  const relevant=lines.filter(line=>mentions.test(line)&&!unsafe.test(line));
  if(!relevant.length)return undefined;
  const priority=/(?:미실행|실행하지|못했|실패|\bfail(?:ed|ure)?\b|\bnot\s+(?:run|executed|tested)\b|\bskipped\b)/i;
  const preferred=relevant.find(line=>priority.test(line))??relevant[relevant.length-1]!;
  return preferred.slice(0,650);
}
