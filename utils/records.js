// 训练记录：本机 storage 为主，登录后与云端 ft_records 双向收敛。
// 同步 = 全量拉取 + updatedAt 较新者胜 + 缺者补推；删除失败才进待删队列，下一轮重试
const storage = require('./storage.js')
const dateUtil = require('./date.js')
const config = require('./config.js')
const cloud = require('./cloud.js')
const account = require('./account.js')

const KEY = 'ft_records'
const PENDING_DELETE_KEY = 'ft_pending_deletes'
const COLL = 'ft_records'
// 统计侧（insights / ai）都按 type 过滤，将来加别的种类时不必改那几处字面量
const TYPE_PLAN = 'plan'
// 拉取上限：异常大的集合会把本地 storage 打满，之后所有写入静默失败
const MAX_PULL_RECORDS = 2000

// ——— 本机存储 ———

function makeId(date, ts) {
  const random = Math.random().toString(36).slice(2, 6)
  return 'r_' + String(date || '').replace(/-/g, '') + '_' + String(ts || Date.now()) + '_' + random
}

function normalize(record) {
  if (!record) return null
  const createdAt = Number(record.createdAt || Date.now())
  return Object.assign({}, record, {
    id: record.id || makeId(record.date, createdAt),
    date: record.date || dateUtil.today(),
    createdAt: createdAt,
    updatedAt: Number(record.updatedAt || createdAt)
  })
}

// 新记录在前，同日按 createdAt 倒序
function byNewest(a, b) {
  const byDate = String(b.date).localeCompare(String(a.date))
  return byDate || Number(b.createdAt) - Number(a.createdAt)
}

// 读穿缓存：一次页面交互里 getAll / 统计 / insights 会重复读同一张表三四遍。
// 写入全部收口在 saveAll，写失败即失效，保证内存不与磁盘不一致
let cache = null

// 每次成功写入自增，页面据此判断「记录变没变」，免得每次 onShow 都重算全表
let version = 0
function revision() {
  return version
}

function readAll() {
  if (cache) return cache
  const raw = storage.read(KEY)
  const all = {}
  if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach(function (id) {
      const rec = normalize(raw[id])
      if (rec) all[rec.id] = rec
    })
  }
  cache = all
  return all
}

// 失败时清掉缓存，下次读回到磁盘的真实状态
function saveAll(next) {
  if (!storage.write(KEY, next)) {
    cache = null
    return false
  }
  cache = next
  version++
  return true
}

function getAll() {
  const all = readAll()
  return Object.keys(all).map(function (id) { return all[id] }).sort(byNewest)
}

function getById(id) {
  return readAll()[id] || null
}

function getDateMapFrom(source) {
  const out = {}
  ;(source || []).forEach(function (record) {
    if (out[record.date]) out[record.date].push(record)
    else out[record.date] = [record]
  })
  return out
}

// 写失败（多为配额溢出）返回 null，绝不谎报成功
function add(record) {
  const next = normalize(record)
  if (!next) return null
  next.updatedAt = Date.now()
  const merged = Object.assign({}, readAll())
  merged[next.id] = next
  return saveAll(merged) ? next : null
}

function remove(id) {
  const all = readAll()
  const rec = all[id]
  if (!rec) return null
  const merged = Object.assign({}, all)
  delete merged[id]
  return saveAll(merged) ? rec : null
}

function replaceAll(source) {
  const next = {}
  Object.keys(source || {}).forEach(function (id) {
    const rec = normalize(source[id])
    if (rec) next[rec.id] = rec
  })
  saveAll(next)
}

// updatedAt 较新者胜；skipIds（本机待删）不回填，避免复活。
// 返回远端 id -> record 映射，省掉调用方为算 toPush 的二次遍历
function mergeRemote(remoteRecords, skipIds) {
  const skip = skipIds || {}
  const all = readAll()
  const remoteMap = {}
  let changed = false
  ;(remoteRecords || []).forEach(function (remote) {
    const r = normalize(remote)
    if (!r) return
    remoteMap[r.id] = r
    if (skip[r.id]) return
    const local = all[r.id]
    if (!local || r.updatedAt > local.updatedAt) {
      all[r.id] = r
      changed = true
    }
  })
  if (changed) saveAll(all)
  return remoteMap
}

// 累计天数 / 连续天数 / 本月天数 / 本月分钟。前三个按「天」算，同日多次只计一天
function computeStatsFrom(source) {
  const ym = dateUtil.monthKey()
  const seen = {}
  let total = 0
  let monthCount = 0
  let monthMinutes = 0
  ;(source || []).forEach(function (record) {
    const date = record.date
    const inMonth = date.indexOf(ym) === 0
    if (!seen[date]) {
      seen[date] = true
      total++
      if (inMonth) monthCount++
    }
    if (inMonth) monthMinutes += Number(record.actualMinutes || 0)
  })

  // 从今天（今天没练就从昨天）逐日回退，断了就停
  const bounds = dateUtil.todayAndYesterday()
  let streak = 0
  let cursor = seen[bounds.today] ? bounds.today : bounds.yesterday
  while (seen[cursor]) {
    streak++
    cursor = dateUtil.addDays(cursor, -1)
  }

  return { total: total, streak: streak, monthCount: monthCount, monthMinutes: monthMinutes }
}

// ——— 云端读写 ———

function syncEnabled() {
  try {
    return !!(config.ENABLE_CLOUD && wx.cloud && wx.cloud.database)
  } catch (e) {
    return false
  }
}

function withDb(task) {
  return cloud.init().then(function (ok) {
    if (!ok || !syncEnabled()) return null
    try {
      return task(wx.cloud.database())
    } catch (e) {
      return null
    }
  }).catch(function () {
    return null
  })
}

function clean(record) {
  const out = {}
  Object.keys(record || {}).forEach(function (key) {
    if (key.charAt(0) !== '_') out[key] = record[key]
  })
  return out
}

function saveOne(record) {
  if (!record || !record.id) return Promise.resolve(false)
  return withDb(function (db) {
    return db.collection(COLL).doc(record.id).set({ data: clean(record) })
      .then(function () { return true })
      .catch(function () { return false })
  }).then(function (result) { return !!result })
}

function removeOne(id) {
  if (!id) return Promise.resolve(false)
  return withDb(function (db) {
    // 文档不存在也算删除成功
    return db.collection(COLL).doc(id).remove()
      .then(function () { return true })
      .catch(function () { return false })
  }).then(function (result) { return !!result })
}

function pushAll(list) {
  const records = Array.isArray(list) ? list : []
  const QUEUE_SIZE = 8
  let index = 0
  let allSucceeded = true
  function next() {
    if (index >= records.length) return Promise.resolve(allSucceeded)
    const batch = records.slice(index, index + QUEUE_SIZE)
    index += QUEUE_SIZE
    return Promise.all(batch.map(saveOne)).then(function (results) {
      if (results.some(function (result) { return !result })) allSucceeded = false
      return next()
    })
  }
  return next()
}

function pullAll() {
  return withDb(function (db) {
    const col = db.collection(COLL)
    const out = []
    const PAGE = 20
    // _id 游标分页：skip 深分页在并发写入时会漏读/重读
    function load(lastId) {
      const query = lastId ? col.where({ _id: db.command.gt(lastId) }) : col
      return query.orderBy('_id', 'asc').limit(PAGE).get().then(function (res) {
        const data = (res && res.data) || []
        let dropped = 0
        data.forEach(function (doc) {
          const rec = clean(doc)
          if (rec.id && rec.updatedAt) out.push(rec)
          else dropped++
        })
        if (dropped) console.warn('[records] 丢弃 ' + dropped + ' 条缺 id/updatedAt 的远端记录')
        return (data.length < PAGE || out.length >= MAX_PULL_RECORDS) ? out : load(data[data.length - 1]._id)
      })
    }
    return load('')
  })
}

// ——— 待删队列：离线删除的兜底 ———

function readPendingDeletes() {
  const list = storage.read(PENDING_DELETE_KEY, [])
  return Array.isArray(list) ? list : []
}

function addPendingDelete(id) {
  const list = readPendingDeletes()
  if (list.indexOf(id) < 0) list.push(id)
  storage.write(PENDING_DELETE_KEY, list)
}

// 返回仍失败的 id
function flushPendingDeletes() {
  const list = readPendingDeletes()
  if (!list.length) return Promise.resolve([])
  return Promise.all(list.map(function (id) {
    return removeOne(id).then(function (ok) { return ok ? '' : id })
  })).then(function (results) {
    const left = results.filter(Boolean)
    storage.write(PENDING_DELETE_KEY, left)
    return left
  })
}

// ——— 对外 ———

function addRecord(record) {
  const saved = add(record)
  if (saved && account.isLoggedIn()) saveOne(saved)
  return saved
}

function removeRecord(id) {
  const removed = remove(id)
  if (removed && account.isLoggedIn()) {
    removeOne(id).then(function (ok) {
      if (!ok) addPendingDelete(id)
    })
  }
  return removed
}

// 仅清本机，云端记录不受影响
function clearLocal() {
  replaceAll({})
  storage.write(PENDING_DELETE_KEY, [])
}

function syncFromCloud() {
  if (!syncEnabled() || !account.isLoggedIn()) return Promise.resolve(false)

  return flushPendingDeletes().then(function (leftDeletes) {
    return pullAll().then(function (remote) {
      // 拉取期间登出了就禁止回填，否则刚清空的记录会被复活
      if (!remote || !account.isLoggedIn()) return false

      const skip = {}
      leftDeletes.forEach(function (id) { skip[id] = true })
      const remoteMap = mergeRemote(remote, skip)

      const toPush = getAll().filter(function (record) {
        const r = remoteMap[record.id]
        return !r || record.updatedAt > r.updatedAt
      })
      return pushAll(toPush)
    })
  })
}

module.exports = {
  TYPE_PLAN: TYPE_PLAN,
  revision: revision,
  getAll: getAll,
  getRecord: getById,
  getDateMapFrom: getDateMapFrom,
  computeStatsFrom: computeStatsFrom,
  syncEnabled: syncEnabled,
  addRecord: addRecord,
  removeRecord: removeRecord,
  clearLocal: clearLocal,
  syncFromCloud: syncFromCloud
}
