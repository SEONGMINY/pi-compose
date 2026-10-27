import { useEffect, useMemo, useState } from 'react';
import type { Agent, Bridge } from './App';

export type ChangedFile = {
  path: string; kind: string; from: string | null;
  diff: string; untracked: boolean; preview: string | null;
};
export type Review = {
  baseSha: string; files: ChangedFile[]; count: number; hasMore: boolean;
  attribution: string; status: string; untracked: string;
};
const kindName: Record<string, string> = {
  A: '추가', M: '수정', D: '삭제', R: '이동', C: '복사', '?': '새 파일',
};
const glyph = (kind: string) => kindName[kind] || '변경';

function Patch({ file }: { file: ChangedFile }) {
  const lines = file.untracked && file.preview !== null
    ? file.preview.split('\n').map(line => '+' + line)
    : file.diff.split('\n');
  if (file.untracked && file.preview === null) {
    return <div className="review-empty">미추적 파일입니다. 바이너리 파일이거나 크기가 커서 미리보기는 지원하지 않습니다.
      <p>파일 내용은 실제 작업 폴더에서 확인할 수 있습니다.</p></div>;
  }
  let oldLine = 0, newLine = 0;
  return <div className="patch-body" role="table" aria-label="Git 파일 차이">
    {lines.map((line, index) => {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
      const addition = line.startsWith('+') && !line.startsWith('+++');
      const removal = line.startsWith('-') && !line.startsWith('---');
      const context = line.startsWith(' ');
      const metadata = /^diff --git|^index |^--- |^\+\+\+ |^new file|^deleted file|^rename/.test(line);
      const n1 = removal || context ? String(oldLine++) : '';
      const n2 = addition || context ? String(newLine++) : '';
      const prefix = hunk ? 'hunk' : metadata ? 'metadata' : addition ? 'added' : removal ? 'deleted' : 'plain';
      return <div className={'patch-row ' + prefix} role="row" key={index}>
        <span className="old-line">{n1}</span><span className="new-line">{n2}</span>
        <code>{line || ' '}</code>
      </div>;
    })}
  </div>;
}

export function GitReview({ agent, bridge, onClose }: { agent: Agent; bridge: Bridge; onClose(): void }) {
  const [data, setData] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filePath, setFilePath] = useState<string | null>(null);
  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const result = await bridge.review(agent.id);
      setData(result);
      setFilePath(current => result.files.some(file => file.path === current)
        ? current : result.files[0]?.path || null);
    } catch(e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [agent.id]);
  const selected = useMemo(() => data?.files.find(f => f.path === filePath), [data, filePath]);
  return <aside className="review-sidebar" aria-label="코드 변경 검토">
    <header className="review-head">
      <div><small>Git 변경 검토</small><h2>{agent.title}</h2></div>
      <div><button aria-label="Git 변경 새로고침" onClick={() => void refresh()}>↻</button>
        <button aria-label="검토 닫기" onClick={onClose}>×</button></div>
    </header>
    <div className="review-status">
      <strong>{loading ? '확인 중…' : error ? '조회 실패' : String(data?.count ?? 0) + '개 파일 변경'}</strong>
      <span>시작 커밋 {data?.baseSha.slice(0, 10) || '확인 중'}</span>
      {data?.attribution && <p>{data.attribution}</p>}
    </div>
    {error && <div className="review-error" role="alert"><p>{error}</p><button onClick={() => void refresh()}>다시 시도</button></div>}
    {!error && !loading && !data?.count && <div className="review-empty">
      <strong>아직 Git 변경이 없습니다.</strong>
      <p>Agent가 실행 중이라면 잠시 후 다시 확인하거나, 해당 터미널에서 구현 진행 상황을 확인하세요.</p>
      <button onClick={() => void refresh()}>변경 다시 확인</button>
    </div>}
    {data && data.count > 0 && <>
      <div className="review-files" aria-label="변경된 파일 목록">
        {data.files.map(file => <button key={file.path}
          className={filePath === file.path ? 'selected' : ''}
          onClick={() => setFilePath(file.path)}>
          <span className={'change-kind '+file.kind}>{glyph(file.kind)}</span>
          <span title={file.path}>{file.path}</span>
        </button>)}
        {data.hasMore && <p>변경 파일이 많아 처음 300개까지만 표시합니다.</p>}
      </div>
      {selected && <div className="review-file-detail">
        <div className="review-file-title"><strong title={selected.path}>{selected.path}</strong>
          <span>{glyph(selected.kind)}</span></div>
        {selected.from && <p>이전 경로: {selected.from}</p>}
        <Patch file={selected} />
      </div>}
    </>}
  </aside>;
}
