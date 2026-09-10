// utils/records.js 训练记录仓库（v2）
// v2 以记录 ID 为主键，支持同一天多次训练。
// 单设备语义：删除即物理删除——本地墓碑仅用于「离线删除后等待同步确认」的临时缓冲。
const dateUtil = require('./date.js')

const KEY = 'ft_checkin_records_v2'
const LEGACY_KEY = 'ft_checkin_records_v1'
const VERSION = 2

function emptyStore() {
  return { version: VERSION, records: {} }
}

function clone(obj) {
  const out = {}
  Object.keys(obj || {}).forEach(function (k) { out[k] = obj[k] })
  return out
}

function makeId(date, ts, index) {
  // 末尾追加随机段，避免同设备同毫秒、本地记录数相同时生成的 ID 冲突。
  const random = Math.random().toString(36).slice(2, 6)
  return 'r_' + String(date || '').replace(/-/g, '') + '_' + String(ts || Date.now()) + '_' + String(index || 0) + '_' + random
}

function normalize(record, fallbackDate, index) {
  if (!record) return null
  const date = record.date || fallbackDate || dateUtil.today()
  const createdAt = Number(record.createdAt || record.ts || Date.now())
  const updatedAt = Number(record.updatedAt || record.ts || createdAt)
  const id = record.id || makeId(date, createdAt, index)
  const next = clone(record)
  next.id = id
  next.date = date
  next.createdAt = createdAt
  next.updatedAt = updatedAt
  next.ts = updatedAt
  next.deletedAt = Number(next.deletedAt || 0)
  return next
}

function migrateLegacy() {
  let legacy = {}
  try { legacy = wx.getStorageSync(LEGACY_KEY) || {} } catch (e) {}
  const store = emptyStore()
  Object.keys(legacy).forEach(function (date, index) {
    const rec = normalize(legacy[date], date, index)
    if (rec) store.records[rec.id] = rec
  })
  return store
}

// 进程内缓存：getStore 只克隆缓存对象，不再每次读存储并整体 clone；
// 每次写入都会经 saveStore 刷新缓存（写后失效）。
let cacheStore = null

function readStored() {
  try {
    const raw = wx.getStorageSync(KEY)
    if (raw && raw.version === VERSION && raw.records && typeof raw.records === 'object') {
      return { version: VERSION, records: clone(raw.records) }
    }
  } catch (e) {}
  return null
}

function getStore() {
  if (!cacheStore) {
    cacheStore = readStored()
    if (!cacheStore) {
      cacheStore = migrateLegacy()
      try {
        wx.setStorageSync(KEY, { version: VERSION, records: clone(cacheStore.records) })
        // 迁移成功后再清理 v1 存储：若 v2 写入失败则保留旧数据，避免丢失。
        wx.removeStorageSync(LEGACY_KEY)
      } catch (e) {}
    }
  }
  // 仍返回浅拷贝包装，保持「外部拿到的 store 可安全当作独立对象」的原语义。
  return { version: VERSION, records: clone(cacheStore.records) }
}

function saveStore(store) {
  const safe = {
    version: VERSION,
    records: clone((store && store.records) || {})
  }
  try { wx.setStorageSync(KEY, safe) } catch (e) {}
  cacheStore = { version: VERSION, records: clone(safe.records) }
  return safe
}

function getAll(options) {
  const opts = options || {}
  const records = getStore().records
  return Object.keys(records).map(function (id) {
    return normalize(records[id], '', id)
  }).filter(function (record) {
    return record && (opts.includeDeleted || !record.deletedAt)
  }).sort(function (a, b) {
    const byDate = String(b.date).localeCompare(String(a.date))
    if (byDate) return byDate
    return Number(b.createdAt) - Number(a.createdAt)
  })
}

function getById(id, includeDeleted) {
  const record = getStore().records[id]
  const normalized = normalize(record, '', id)
  if (!normalized || (!includeDeleted && normalized.deletedAt)) return null
  return normalized
}

function getByDate(date, includeDeleted) {
  return getAll({ includeDeleted: includeDeleted }).filter(function (record) {
    return record.date === date
  }).sort(function (a, b) {
    return Number(a.createdAt) - Number(b.createdAt)
  })
}

// 从已读取的记录数组派生「日期 -> 记录」映射，供调用方一次读取后复用同一份快照。
function getDateMapFrom(list) {
  const out = {}
  ;(list || []).forEach(function (record) {
    if (!out[record.date]) out[record.date] = []
    out[record.date].push(record)
  })
  return out
}

function getDateMap() {
  return getDateMapFrom(getAll())
}

function add(record) {
  const store = getStore()
  const now = Date.now()
  const next = normalize(record, (record && record.date) || dateUtil.today(), now)
  next.id = (record && record.id) || makeId(next.date, now, Object.keys(store.records).length)
  next.createdAt = Number((record && record.createdAt) || now)
  next.updatedAt = now
  next.ts = now
  next.deletedAt = 0
  store.records[next.id] = next
  saveStore(store)
  return next
}

function remove(id) {
  const store = getStore()
  const current = normalize(store.records[id], '', id)
  if (!current || current.deletedAt) return null
  const now = Date.now()
  current.deletedAt = now
  current.updatedAt = now
  current.ts = now
  store.records[id] = current
  saveStore(store)
  return current
}

// 硬删除：直接把某条记录从本机移除（云端已确认物理删除后调用）。
function drop(id) {
  const store = getStore()
  if (!store.records[id]) return null
  const rec = store.records[id]
  delete store.records[id]
  saveStore(store)
  return rec
}

// 清理本机已同步的墓碑记录（deletedAt > 0）：云端已物理删除，本地不再保留删除标记。
function purgeDeleted() {
  const store = getStore()
  let count = 0
  Object.keys(store.records).forEach(function (id) {
    const rec = store.records[id]
    if (rec && Number(rec.deletedAt || 0) > 0) {
      delete store.records[id]
      count++
    }
  })
  if (count) saveStore(store)
  return count
}

function replaceAll(records) {
  const store = emptyStore()
  Object.keys(records || {}).forEach(function (id) {
    const rec = normalize(records[id], '', id)
    if (rec) store.records[rec.id] = rec
  })
  saveStore(store)
  return store
}

function mergeRemote(remoteRecords) {
  const local = getStore()
  const merged = clone(local.records)
  ;(remoteRecords || []).forEach(function (remote) {
    const r = normalize(remote, '', remote && remote.id)
    if (!r) return
    const localRecord = normalize(merged[r.id], '', r.id)
    if (!localRecord || Number(r.updatedAt || r.ts) > Number(localRecord.updatedAt || localRecord.ts)) {
      merged[r.id] = r
    }
  })
  return replaceAll(merged)
}

// 只对快照做一次读取，避免同一轮统计里反复 getAll（重复读存储、排序、clone）。
// computeStatsFrom 接收已读取的记录数组，供调用方一次读取后派生统计。
function computeStatsFrom(list) {
  const dateMap = {}
  ;(list || []).forEach(function (record) {
    if (!dateMap[record.date]) dateMap[record.date] = []
    dateMap[record.date].push(record)
  })
  const dates = Object.keys(dateMap).sort()
  const { today, yesterday } = dateUtil.todayAndYesterday()
  let streak = 0
  let cursor = dateMap[today] ? today : yesterday
  while (dateMap[cursor] && dateMap[cursor].length) {
    streak++
    cursor = dateUtil.addDays(cursor, -1)
  }

  const now = new Date()
  const ym = now.getFullYear() + '-' + dateUtil.pad(now.getMonth() + 1)
  let monthCount = 0
  let monthMinutes = 0
  dates.forEach(function (date) {
    if (date.indexOf(ym) !== 0) return
    monthCount++
    dateMap[date].forEach(function (record) {
      monthMinutes += Number(record.actualMinutes || record.duration || 0)
    })
  })

  return {
    total: dates.length,
    streak: streak,
    monthCount: monthCount,
    monthMinutes: monthMinutes
  }
}

function computeStats() {
  return computeStatsFrom(getAll())
}

module.exports = {
  getAll: getAll,
  getById: getById,
  getByDate: getByDate,
  getDateMap: getDateMap,
  add: add,
  remove: remove,
  drop: drop,
  purgeDeleted: purgeDeleted,
  replaceAll: replaceAll,
  mergeRemote: mergeRemote,
  computeStats: computeStats,
  computeStatsFrom: computeStatsFrom,
  getDateMapFrom: getDateMapFrom
}
