// utils/records.js 训练记录仓库（以记录 ID 为主键，支持一天多次训练）
// 单设备语义：删除即物理删除，本地墓碑仅作离线删除待同步的临时缓冲
const dateUtil = require('./date.js')

const KEY = 'ft_checkin_records_v2'
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
  // 末尾随机段避免 ID 冲突
  const random = Math.random().toString(36).slice(2, 6)
  return 'r_' + String(date || '').replace(/-/g, '') + '_' + String(ts || Date.now()) + '_' + String(index || 0) + '_' + random
}

function normalize(record, fallbackDate, index) {
  if (!record) return null
  const date = record.date || fallbackDate || dateUtil.today()
  const createdAt = Number(record.createdAt || Date.now())
  const updatedAt = Number(record.updatedAt || createdAt)
  const id = record.id || makeId(date, createdAt, index)
  const next = clone(record)
  next.id = id
  next.date = date
  next.createdAt = createdAt
  next.updatedAt = updatedAt
  next.deletedAt = Number(next.deletedAt || 0)
  return next
}

// 进程内缓存：读写都基于缓存，写入后经 saveStore 刷新
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

// 确保缓存就绪，返回缓存原对象供只读路径使用
function ensureStore() {
  if (!cacheStore) {
    cacheStore = readStored() || emptyStore()
  }
  return cacheStore
}

// 写路径：返回 records 浅拷贝，避免污染缓存
function getStore() {
  return { version: VERSION, records: clone(ensureStore().records) }
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
  // 只读遍历缓存原对象；normalize 逐条 clone，调用方拿到独立副本
  const records = ensureStore().records
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
  const record = ensureStore().records[id]
  const normalized = normalize(record, '', id)
  if (!normalized || (!includeDeleted && normalized.deletedAt)) return null
  return normalized
}

// 从记录数组派生「日期 → 记录」映射
function getDateMapFrom(list) {
  const out = {}
  ;(list || []).forEach(function (record) {
    if (!out[record.date]) out[record.date] = []
    out[record.date].push(record)
  })
  return out
}

function add(record) {
  const store = getStore()
  const now = Date.now()
  const next = normalize(record, (record && record.date) || dateUtil.today(), now)
  next.id = (record && record.id) || makeId(next.date, now, Object.keys(store.records).length)
  next.createdAt = Number((record && record.createdAt) || now)
  next.updatedAt = now
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
  store.records[id] = current
  saveStore(store)
  return current
}

// 硬删除：从本机移除某条记录（云端已确认物理删除后调用）
function drop(id) {
  const store = getStore()
  if (!store.records[id]) return null
  const rec = store.records[id]
  delete store.records[id]
  saveStore(store)
  return rec
}

// 清理本机已同步的墓碑记录（deletedAt > 0）
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
  // 只读缓存原对象（不修改 local.records），合并结果写入独立副本。
  const local = ensureStore()
  const merged = clone(local.records)
  let changed = false
  ;(remoteRecords || []).forEach(function (remote) {
    const r = normalize(remote, '', remote && remote.id)
    if (!r) return
    const localRecord = normalize(merged[r.id], '', r.id)
    if (!localRecord || Number(r.updatedAt) > Number(localRecord.updatedAt)) {
      merged[r.id] = r
      changed = true
    }
  })
  // 无更新则直接返回，避免每轮同步全量重写本地存储
  if (!changed) return { version: VERSION, records: clone(merged) }
  return replaceAll(merged)
}

// 从已读取的记录数组派生统计，避免同一轮反复 getAll
function computeStatsFrom(list) {
  const dateMap = getDateMapFrom(list)
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
      monthMinutes += Number(record.actualMinutes || 0)
    })
  })

  return {
    total: dates.length,
    streak: streak,
    monthCount: monthCount,
    monthMinutes: monthMinutes
  }
}

module.exports = {
  getAll: getAll,
  getById: getById,
  add: add,
  remove: remove,
  drop: drop,
  purgeDeleted: purgeDeleted,
  replaceAll: replaceAll,
  mergeRemote: mergeRemote,
  computeStatsFrom: computeStatsFrom,
  getDateMapFrom: getDateMapFrom
}
