export type ComposeProvenance = {
  packageRoot:string;version:string;revision:string|null;ref:string|null;origin:string;
};
export type ActiveExtensionProvenance = ComposeProvenance & {
  extensionFile:string;processId:number;mode:string;loadedAt:string;
  modifiedAt:string|null;modifiedAfterLoad:boolean;
};
export function installedProvenance(root:string):ComposeProvenance;
export function installedExecutables(searchPath?:string):Array<{command:string;path:string}>;
export function activeExtensionReport(extensionFile:string, options?:{
  root?:string;mode?:string;startedAt?:number;
}):ActiveExtensionProvenance;
export function versionReport(info:ActiveExtensionProvenance):string;
