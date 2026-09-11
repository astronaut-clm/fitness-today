const records = require('./records.js')
const sync = require('./sync.js')
const account = require('./account.js')

// 增量同步水位：只在整轮「拉取+推送」全部成功后才推进，
// 掉线期间未推成功的记录（updatedAt 晚于水位）会在下一轮自动补推，不会每轮全量重传历史。
const SYNC_META_KEY = 'ft_sync_meta_v1'
const FULL_PULL_INTERVAL = 12 * 3600 * 1000 // 每 12 小时做一次全量拉取，自愈跨设备时钟偏差导致的漏拉

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
    // 单设备语义：删除立即同步为云端物理删除，成功后本机墓碑一并清除。
    // 若本次推送失败（离线等），墓碑会保留到下一轮同步时重推删除。
    sync.pushOne(removed).then(function (ok) {
      if (ok) records.drop(id)
    }).catch(function () {})
  }
  return removed
}

function getRecord(id) {
  return records.getById(id)
}

// 清空本机全部训练记录（退出登录时调用；云端数据不受影响，登录后可拉回）。
function clearLocal() {
  records.replaceAll({})
  // 记录清空后把同步水位归零：下次登录会按「首次同步」全量拉回云端记录。
  saveSyncMeta({ lastSyncAt: 0, lastFullPullAt: 0 })
}

// 从已读取的记录数组派生「日期 -> 记录」映射，供调用方一次读取后复用同一份快照。
function getDateMapFrom(list) {
  return records.getDateMapFrom(list)
}

function getAllRecords() {
  return records.getAll()
}

// 从已读取的记录数组派生统计，供调用方一次读取后复用同一份快照。
function computeStatsFrom(list) {
  return records.computeStatsFrom(list)
}

function syncEnabled() {
  return sync.enabled()
}

function syncFromCloud() {
  // 仅登录用户可同步训练记录；未登录/登出时不拉取也不推送。
  if (!sync.enabled() || !account.isLoggedIn()) return Promise.resolve(false)

  const meta = readSyncMeta()
  const now = Date.now()
  // 有水位时增量拉取；首次同步、登出后重登、或超过自愈周期时全量拉取。
  const needsFullPull = !meta.lastSyncAt || !meta.lastFullPullAt || (now - meta.lastFullPullAt) >= FULL_PULL_INTERVAL
  const remotePromise = needsFullPull ? sync.pullAll() : sync.pullSince(meta.lastSyncAt)

  return remotePromise.then(function (remote) {
    // 拉取失败时向上抛出真实错误，由调用方决定是否提示用户。
    if (!remote) return false

    // 拉取期间可能已退出登录：此时禁止再用云端数据回填本机，
    // 否则登出时已清空的记录会被这条在途同步"复活"。
    if (!account.isLoggedIn()) return false

    // 合并前先收集本地待推改动（含删除墓碑），合并后仍保持原 updatedAt 的才算真正的本地增量。
    const before = {}
    const pending = records.getAll({ includeDeleted: true }).filter(function (record) {
      const ts = Number(record.updatedAt || record.ts || 0)
      if (ts <= Number(meta.lastSyncAt || 0)) return false
      before[record.id] = ts
      return true
    })

    records.mergeRemote(remote)

    // 已被更新的远端覆盖的不再回推，其余本地新增/修改/删除才是待推增量。
    const toPush = pending.filter(function (record) {
      const current = records.getById(record.id, true)
      return current && Number(current.updatedAt || current.ts || 0) === before[record.id]
    })

    return sync.pushAll(toPush).then(function (ok) {
      if (!ok) return false
      // 推送期间也可能已退出登录：此时不能推进同步水位，
      // 否则会覆盖 clearLocal 归零的水位，导致再次登录时漏拉历史记录。
      if (!account.isLoggedIn()) return false
      saveSyncMeta({
        lastSyncAt: Date.now(),
        lastFullPullAt: needsFullPull ? Date.now() : meta.lastFullPullAt
      })
      // 单设备语义：删除即物理生效。同步成功后清理本机墓碑，
      // 并清扫云端早期版本遗留的墓碑文档（尽力而为，失败不阻塞）。
      records.purgeDeleted()
      sync.purgeCloudDeleted().catch(function () {})
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
