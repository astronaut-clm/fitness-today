const records = require('./records.js')
const sync = require('./sync.js')
const account = require('./account.js')

// 增量同步水位：整轮拉取+推送全部成功才推进，未推成功的下一轮自动补推
const SYNC_META_KEY = 'ft_sync_meta_v1'
const FULL_PULL_INTERVAL = 12 * 3600 * 1000 // 每 12 小时全量拉取一次，自愈时钟偏差导致的漏拉

function readSyncMeta() {
  const fallback = { lastSyncAt: 0, lastFullPullAt: 0 }
  try { return Object.assign(fallback, wx.getStorageSync(SYNC_META_KEY) || {}) } catch (e) { return fallback }
}

function saveSyncMeta(meta) {
  const safe = {
    lastSyncAt: Number(meta && meta.lastSyncAt) || 0,
    lastFullPullAt: Number(meta && meta.lastFullPullAt) || 0
  }
  try { wx.setStorageSync(SYNC_META_KEY, safe) } catch (e) {}
  return safe
}

function addRecord(record) {
  const saved = records.add(record)
  if (account.isLoggedIn()) sync.pushOne(saved)
  return saved
}

function removeRecord(id) {
  const removed = records.remove(id)
  if (removed && account.isLoggedIn()) {
    // 删除立即同步为云端物理删除，成功后清除本机墓碑；失败则留待下轮重推
    sync.pushOne(removed).then(function (ok) {
      if (ok) records.drop(id)
    }).catch(function () {})
  }
  return removed
}

function getRecord(id) {
  return records.getById(id)
}

// 清空本机全部训练记录（退出登录时调用；云端不受影响）
function clearLocal() {
  records.replaceAll({})
  // 水位归零，下次登录按首次同步全量拉回
  saveSyncMeta({ lastSyncAt: 0, lastFullPullAt: 0 })
}

// 从记录数组派生「日期 → 记录」映射
function getDateMapFrom(list) {
  return records.getDateMapFrom(list)
}

function getAllRecords() {
  return records.getAll()
}

// 从记录数组派生统计
function computeStatsFrom(list) {
  return records.computeStatsFrom(list)
}

function syncEnabled() {
  return sync.enabled()
}

function syncFromCloud() {
  // 仅登录用户可同步
  if (!sync.enabled() || !account.isLoggedIn()) return Promise.resolve(false)

  const meta = readSyncMeta()
  const now = Date.now()
  // 有水位时增量拉取，否则（首次/重登/超周期）全量拉取
  const needsFullPull = !meta.lastSyncAt || !meta.lastFullPullAt || (now - meta.lastFullPullAt) >= FULL_PULL_INTERVAL
  const remotePromise = needsFullPull ? sync.pullAll() : sync.pullSince(meta.lastSyncAt)

  return remotePromise.then(function (remote) {
    // 拉取失败返回 false
    if (!remote) return false

    // 拉取期间可能已登出：禁止再用云端数据回填，否则清空的记录会被"复活"
    if (!account.isLoggedIn()) return false

    // 合并前收集本地待推改动（含墓碑），合并后 updatedAt 未变的才算本地增量
    const before = {}
    const pending = records.getAll({ includeDeleted: true }).filter(function (record) {
      const ts = Number(record.updatedAt || 0)
      if (ts <= Number(meta.lastSyncAt || 0)) return false
      before[record.id] = ts
      return true
    })

    records.mergeRemote(remote)

    // 被远端覆盖的不回推，其余本地改动才待推
    const toPush = pending.filter(function (record) {
      const current = records.getById(record.id, true)
      return current && Number(current.updatedAt || 0) === before[record.id]
    })

    return sync.pushAll(toPush).then(function (ok) {
      if (!ok) return false
      // 推送期间可能已登出：不能推进水位，否则会覆盖 clearLocal 的归零导致漏拉
      if (!account.isLoggedIn()) return false
      saveSyncMeta({
        lastSyncAt: Date.now(),
        lastFullPullAt: needsFullPull ? Date.now() : meta.lastFullPullAt
      })
      // 同步成功后清理本机墓碑
      records.purgeDeleted()
      return true
    })
  })
}

module.exports = {
  getAllRecords: getAllRecords,
  getDateMapFrom: getDateMapFrom,
  getRecord: getRecord,
  addRecord: addRecord,
  removeRecord: removeRecord,
  clearLocal: clearLocal,
  computeStatsFrom: computeStatsFrom,
  syncEnabled: syncEnabled,
  syncFromCloud: syncFromCloud
}
