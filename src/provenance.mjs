import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$/i;
const bounded = (s) => String(s).slice(0, 256);
const rooted = (p) => { try {return realpathSync(p);} catch {return resolve(p);} };
export function installedProvenance(root) {
  const packageRoot = rooted(root);
  let revision = null;
  let ref = null;
  let origin = 'unverified';
  const stamp = join(packageRoot, '.compose-install.json');
  try {
    const data = JSON.parse(readFileSync(stamp, 'utf8'));
    if (data?.schema === 1 && SHA.test(data.commit) &&
      data.packageRoot === packageRoot && data.ref && typeof data.ref === 'string') {
      revision = data.commit;
      ref = bounded(data.ref);
      origin = 'installer-pinned';
    }
  } catch { /* direct npm install does not have this metadata */ }
  const git = spawnSync('git', ['-C', packageRoot, 'rev-parse', '--show-toplevel', 'HEAD'],
    {encoding:'utf8',timeout:1500});
  if (!revision && !git.error && git.status === 0) {
    const lines=git.stdout.trim().split('\n');
    if (lines.length === 2 && rooted(lines[0]) === packageRoot && SHA.test(lines[1])) {
      revision = lines[1];
      origin = 'git-checkout';
    }
  }
  let version='unknown';
  try {version=JSON.parse(readFileSync(join(packageRoot,'package.json'),'utf8')).version || 'unknown';}
  catch {}
  return {packageRoot, version, revision, ref, origin};
}

export function activeExtensionReport(extensionFile, {root, mode = 'unknown', startedAt} = {}) {
  const path = rooted(extensionFile);
  const source = installedProvenance(root || dirname(dirname(path)));
  let modifiedAfterLoad = false;
  let modifiedAt = null;
  try {
    modifiedAt = statSync(path).mtime.toISOString();
    modifiedAfterLoad = Boolean(startedAt && statSync(path).mtimeMs > startedAt);
  } catch {}
  return {
    ...source, extensionFile:path, processId:process.pid, mode,
    loadedAt:new Date(startedAt || Date.now()).toISOString(), modifiedAt, modifiedAfterLoad,
  };
}

export function versionReport(info) {
  return [
    '실행 중인 Pi Compose Extension:',
    '역할: '+info.mode+' / PID: '+info.processId,
    '실제 파일: '+info.extensionFile,
    '패키지 위치: '+info.packageRoot,
    '패키지 버전: '+info.version,
    '설치된 Git 커밋: '+(info.revision || '확인 불가 — 설치 소스 검증 필요'),
    '설치 Ref: '+(info.ref || '확인 불가')+' / 근거: '+info.origin,
    '현재 프로세스 로드 시각: '+info.loadedAt,
    ...(info.modifiedAfterLoad ? ['경고: Extension 파일이 Pi 프로세스 시작 이후 변경됐습니다. /reload 또는 재시작해야 새 코드를 사용할 수 있습니다.'] : []),
    '다른 Pi 프로세스의 Extension 버전은 각 창에서 별도 확인해야 합니다.',
  ].join('\n');
}

export function installedExecutables(searchPath = process.env.PATH || '') {
  const result=[];
  for(const dir of searchPath.split(':').filter(Boolean)) {
    const path=join(dir,'pic');
    if (!existsSync(path)) continue;
    try {
      const real=rooted(path);
      if (!result.some(x=>x.path===real)) result.push({command:path,path:real});
    } catch {}
  }
  return result;
}
