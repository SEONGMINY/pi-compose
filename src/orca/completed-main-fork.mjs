import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function readCompleteJsonl(path) {
  const body = readFileSync(path, 'utf8')
  const lines = body.split('\n')
  const result = []
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]
    if (!text.trim()) continue
    try {
      result.push(JSON.parse(text))
    } catch (error) {
      // A live Pi process can be in the middle of appending its last JSONL line.
      // Never repair or append to the Main's original file.
      if (i === lines.length - 1 && !body.endsWith('\n')) break
      throw new Error('Main Pi 대화 기록에 손상된 JSONL 항목이 있습니다.')
    }
  }
  return result
}

function branchFrom(entries, leafId) {
  const ids = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id)) {
      throw new Error('Pi 대화 항목 ID가 없거나 중복되어 Fork할 수 없습니다.')
    }
    ids.set(entry.id, entry)
  }
  const parents = new Set(entries.map(entry => entry.parentId).filter(Boolean))
  const leaves = entries.filter(entry => !parents.has(entry.id))
  // JSONL alone cannot tell which branch an in-process Pi has selected.
  // Fail closed rather than silently selecting the newest append of another branch.
  if (!leafId && leaves.length !== 1) {
    throw new Error('Main 세션에 여러 대화 분기가 있습니다. 활성 leaf ID를 확인한 뒤 Fork해야 합니다.')
  }
  let entry = ids.get(leafId || leaves[0]?.id)
  if (!entry) throw new Error('선택한 Main 대화 지점이 존재하지 않습니다.')
  const visited = new Set()
  const branch = []
  while (entry) {
    if (visited.has(entry.id)) throw new Error('Pi 대화 분기에 순환 참조가 있습니다.')
    visited.add(entry.id)
    branch.push(entry)
    if (entry.parentId !== null && !ids.has(entry.parentId)) {
      throw new Error('Pi 대화 분기의 부모 항목을 찾을 수 없습니다.')
    }
    entry = entry.parentId === null ? undefined : ids.get(entry.parentId)
  }
  return branch.reverse()
}

/**
 * Capture only a finished assistant response on the selected Pi branch.
 * The source JSONL is read-only. For multi-branch live sessions, callers
 * must supply the active leaf from Pi's authoritative RPC get_entries result.
 */
export function captureCompletedMain({ sessionFile, sessionId, activeLeafId }) {
  const sourceFile = resolve(sessionFile)
  const rows = readCompleteJsonl(sourceFile)
  const header = rows[0]
  if (header?.type !== 'session' || header.id !== sessionId) {
    throw new Error('Main Pi 세션 파일과 식별자가 일치하지 않습니다.')
  }
  const branch = branchFrom(rows.slice(1), activeLeafId)
  const lastDone = branch.findLastIndex(entry =>
    entry.type === 'message' &&
    entry.message?.role === 'assistant' &&
    entry.message?.stopReason === 'stop' &&
    entry.message?.endTurn !== false)
  if (lastDone < 0) {
    throw new Error('Main에 아직 완료된 Pi 응답이 없습니다. 응답 완료 후 다시 시도하세요.')
  }
  const completed = branch.slice(0, lastDone + 1)
  return {
    sourceFile,
    sourceSessionId: sessionId,
    sourceEntryId: completed.at(-1).id,
    sourceEntryIds: completed.map(entry => entry.id),
    entries: completed,
    header,
    excludedInProgress: lastDone !== branch.length - 1
  }
}

function rewriteOwnForkHeader(path, sourceFile) {
  const rows = readCompleteJsonl(path)
  if (rows[0]?.type !== 'session') throw new Error('새 Pi 세션의 헤더가 없습니다.')
  const next = [{ ...rows[0], parentSession: sourceFile }, ...rows.slice(1)]
  const tmp = path + '.' + randomUUID() + '.tmp'
  writeFileSync(tmp, next.map(entry => JSON.stringify(entry)).join('\n') + '\n', {
    flag: 'wx', mode: 0o600
  })
  renameSync(tmp, path)
}

/**
 * Pi's forkFrom copies the whole JSONL (including abandoned branches and
 * in-flight turns). Feed it an immutable, selected-branch snapshot instead,
 * then restore the *original* parentSession in our new child only.
 */
export function forkCompletedMain({ snapshot, targetCwd, id, SessionManager }) {
  const folder = mkdtempSync(join(tmpdir(), 'pi-compose-main-fork-'))
  const path = join(folder, 'snapshot.jsonl')
  let child
  try {
    writeFileSync(path,
      [snapshot.header, ...snapshot.entries].map(entry => JSON.stringify(entry)).join('\n') + '\n',
      { flag: 'wx', mode: 0o600 })
    child = SessionManager.forkFrom(path, targetCwd, undefined, { id })
    const target = child.getSessionFile()
    if (!target || !existsSync(target) || resolve(target) === snapshot.sourceFile) {
      throw new Error('Pi가 별도 Fork 세션 파일을 생성하지 않았습니다.')
    }
    rewriteOwnForkHeader(target, snapshot.sourceFile)
    const rows = readCompleteJsonl(target)
    const copied = rows.slice(1)
    if (rows[0].id !== child.getSessionId() ||
        rows[0].parentSession !== snapshot.sourceFile ||
        copied.length !== snapshot.entries.length ||
        copied.some((entry, index) =>
          JSON.stringify(entry) !== JSON.stringify(snapshot.entries[index]))) {
      throw new Error('생성한 Work 세션의 기록이 선택한 Main 분기와 일치하지 않습니다.')
    }
    return { sessionId: child.getSessionId(), sessionFile: target }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
