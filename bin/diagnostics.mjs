import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { clearDiagnostics, configureDiagnostics, diagnosticStatus, diagnosticsDir, exportDiagnostics, analyzeDiagnostics, readDiagnosticEvents } from '../src/diagnostics.mjs';

export function diagnosticsCli(args) {
  const [command,...rest]=args;
  const usage='Usage: pic diagnostics status|on|off|export [--days 1-30] [--run UUID] [--output /path/report.json]|summary [--days 1-30]|clear --yes';
  if(command==='status' && rest.length===0){console.log(JSON.stringify(diagnosticStatus(),null,2));return 0;}
  if((command==='on'||command==='off')&&rest.length===0) {
    configureDiagnostics(command==='on');
    console.log('Local UX diagnostics '+(command==='on'?'enabled':'disabled')+'. No network transmission.');
    return 0;
  }
  if(command==='clear'&&rest.length===1&&rest[0]==='--yes'){
    console.log('Deleted '+clearDiagnostics()+' local event files. Diagnostic preference preserved.');
    return 0;
  }
  if(command==='export'||command==='summary'){
    let days=7,output,runId;
    for(let i=0;i<rest.length;i++){
      if(rest[i]==='--days'){const n=Number(rest[++i]);if(!Number.isInteger(n)||n<1||n>30){console.error(usage);return 2;}days=n;}
      else if(rest[i]==='--run'&&command==='export') {runId=rest[++i];if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId||'')){console.error(usage);return 2;}}
      else if(rest[i]==='--output'&&command==='export'){output=rest[++i];if(!output){console.error(usage);return 2;}}
      else {console.error(usage);return 2;}
    }
    try {
      if(command==='summary') {console.log(JSON.stringify(analyzeDiagnostics(readDiagnosticEvents({days})),null,2));return 0;}
      // Write one shareable report by default, not raw log lines in the terminal.
      const defaultName='pi-compose-ux-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
      const privateExports=join(diagnosticsDir(),'exports');
      if(!output)mkdirSync(privateExports,{recursive:true,mode:0o700});
      const dest=output?resolve(output):join(privateExports,defaultName);
      const {report}=exportDiagnostics({days,output:dest,runId});
      console.log('Diagnostic report: '+dest);
      console.log('Events: '+report.summary.observedEvents+' | Retention: '+diagnosticStatus().retentionDays+' days');
      console.log('No prompts, code, Git diff or raw project/session paths are exported. Review before sharing.');
      return 0;
    }catch(error){console.error('pic diagnostics: '+String(error));return 1;}
  }
  console.error(usage);return 2;
}
