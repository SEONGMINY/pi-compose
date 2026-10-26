export type DiagnosticEvent = 
 | 'setup.started' | 'setup.component' | 'setup.finished' | 'setup.hook_prompted'
 | 'command.entered' | 'command.invalid' | 'command.finished'
 | 'launch.started' | 'launch.approval' | 'launch.finished' | 'launch.agent_linked'
 | 'navigation.opened' | 'navigation.selected' | 'navigation.finished' | 'navigation.detail'
 | 'switch.started' | 'switch.finished' | 'sessions.opened' | 'sessions.finished'
 | 'handoff.started' | 'handoff.finished' | 'verify.started' | 'verify.finished'
 | 'result.opened' | 'result.unavailable';
export type DiagnosticSource='slash'|'natural-language'|'menu'|'automatic'|'cli'|'unknown';
export type DiagnosticOutcome='success'|'failure'|'cancelled'|'unavailable'|'unknown';
export interface Flow {flowId:string;started:number}
export interface DiagnosticOptions {
  source?:DiagnosticSource;
  flowId?:string;
  run?:string;
  outcome?:DiagnosticOutcome;
  data?:Record<string,boolean|string|number|undefined>;
  taskId?:string;sessionId?:string;projectId?:string;
}
export const SCHEMA_VERSION: 1;
export function diagnosticsDir():string;
export function diagnosticEnabled():boolean;
export function diagnosticStatus():{enabled:boolean;dir:string;retentionDays:number;maxBytes:number};
export function configureDiagnostics(enabled:boolean):void;
export function diagnosticEvent(event:DiagnosticEvent,options?:DiagnosticOptions):void;
export function startFlow(event:DiagnosticEvent,details?:DiagnosticOptions):Flow;
export function finishFlow(flow:Flow|undefined,event:DiagnosticEvent,details?:DiagnosticOptions):void;
export function diagnosticFlowId():string;
export function readDiagnosticEvents(options?:{days?:number}): Array<{event:DiagnosticEvent; timestamp:string; flowId:string; source:DiagnosticSource; outcome:DiagnosticOutcome; data:Record<string,unknown>}>;
export function analyzeDiagnostics(events:Array<Record<string,any>>):Record<string,unknown>;
export function exportDiagnostics(options?:{days?:number;output?:string}):{path?:string;report:Record<string,any>};
export function clearDiagnostics():number;
