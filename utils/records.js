// 训练记录：本机 storage 为主，登录后与云端 ft_records 集合双向收敛
// 同步 = 全量拉取 + updatedAt 较新者胜 + 缺者补推；
// 删除即本机物理删除，云端删除失败才进待删队列，留到下一轮重试
const storage = require('./storage.js')
const dateUtil = require('./date.js')
const config = require('./config.js')
const cloud = require('./cloud.js')
const account = require('./account.js')

const KEY = 'ft_records'
const PENDING_DELETE_KEY = 'ft_pending_deletes'
const COLL = 'ft_records'
// 记录种类。目前只有「跟练完一个计划」一种，但统计侧（insights / ai）都按 type 过滤，
// 将来加别的种类（如手动补录）时不必回去改那几处的字面量
const TYPE_PLAN = 'plan'
// 单次全量拉取的上限：异常大的云端集合会把本地 storage 打满，
// 届时所有写入都会静默失败，宁可少拉也不能拖垮本地存储
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

// 新记录在前：同日按 createdAt 倒序
function byNewest(a, b) {
  const byDate = String(b.date).localeCompare(String(a.date))
  return byDate || Number(b.createdAt) - Number(a.createdAt)
}

// 读出全部记录，顺手补齐 id / date / 时间戳等缺省字段。
// 读穿缓存：一次页面交互里 getAll / computeStatsFrom / insights / coachProfile
// 会重复读同一张表三四遍，每次都真读 storage 并逐条归一化没必要。
// 所有写入都收口在 saveAll，写失败时主动失效，保证内存不会和磁盘不一致。
let cache = null

// 数据版本号：每次成功写入自增。页面可用它判断「记录有没有变」，
// 不必在每次 onShow 都把全表统计重算一遍
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

// 持久化并返回是否成功；失败时清掉读穿缓存，下次读会回到磁盘的真实状态
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

// 写失败（一般是配额溢出）返回 null，由调用方提示，绝不谎报成功
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

// updatedAt 较新者胜；skipIds 中的 id 不回填（本机待删，避免复活）
// 返回远端 id -> record 映射，供调用方计算待补推的本机记录，省去二次遍历
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

// 统计四个数：累计训练天数、连续天数、本月天数、本月分钟。
// total / monthCount 算的是「天数」，所以同一天练两次只算一天，用 seen 去重
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

  // 连续天数：从今天（今天没练就从昨天）往前一天天回退，断了就停
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
    // 文档不存在也视为删除成功
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
    // _id 游标分页，避免 skip 深分页在并发写入时漏读/重读
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

// ——— 待删队列（离线删除的兜底） ———

function readPendingDeletes() {
  const list = storage.read(PENDING_DELETE_KEY, [])
  return Array.isArray(list) ? list : []
}

function addPendingDelete(id) {
  const list = readPendingDeletes()
  if (list.indexOf(id) < 0) list.push(id)
  storage.write(PENDING_DELETE_KEY, list)
}

// 重试待删队列，返回仍失败的 id
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

// ——— 对外：写操作与同步 ———

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
      // 拉取期间已登出则禁止回填，否则清空的记录会被复活
      if (!remote || !account.isLoggedIn()) return false

      const skip = {}
      leftDeletes.forEach(function (id) { skip[id] = true })
      // mergeRemote 顺带返回远端映射，无需为了算 toPush 再遍历一遍 remote
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
