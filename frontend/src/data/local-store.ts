import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 结构调整（加字段、加模块、改种子口径）时抬版本号，旧缓存整包回落到新种子，避免深浅合并出新旧混表。
const STORAGE_VERSION = 2
const STORAGE_KEY = 'substation-protection:entries'
const VERSION_KEY = 'substation-protection:version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeSeed(fallback: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const version = window.localStorage.getItem(VERSION_KEY)
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw || version !== String(STORAGE_VERSION)) {
    writeSeed(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    writeSeed(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
