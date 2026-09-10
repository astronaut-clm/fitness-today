// utils/sync.js 训练记录云端同步（v2）
// 每条训练记录独立文档；单设备语义：删除记录即物理删除云端文档，不保留墓碑。
const config = require('./config.js')
const cloud = require('./cloud.js')

const COLL = 'ft_records'

function enabled() {
  try {
    return !!(config.ENABLE_CLOUD && wx.cloud && wx.cloud.database)
  } catch (e) {
    return false
  }
}

function withDb(task, rethrow) {
  return cloud.ready().then(function (ok) {
    if (!ok || !enabled()) {
      if (rethrow) throw new Error('cloud_unavailable')
      return null
    }
    try {
      return task(wx.cloud.database())
    } catch (e) {
      if (rethrow) throw e
      return null
    }
  }).catch(function (e) {
    if (rethrow) throw e
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

function pushOne(record) {
  if (!record || !record.id) return Promise.resolve(false)
  return withDb(function (db) {
    const col = db.collection(COLL)
    const op = Number(record.deletedAt || 0) > 0
      // 单设备语义：删除记录 = 云端物理删除该文档（文档不存在时也视为成功）。
      ? col.doc(record.id).remove()
      : col.doc(record.id).set({ data: clean(record) })
    return op.then(function () {
      return true
    }).catch(function () { return false })
  }).then(function (result) { return !!result })
}

// 清扫云端遗留的墓碑文档（deletedAt > 0）：早期版本以墓碑形式保留已删记录，
// 单设备语义下不再需要，随同步周期逐页物理清除。尽力而为，失败不阻塞主流程。
function purgeCloudDeleted() {
  return withDb(function (db) {
    const col = db.collection(COLL)
    // 边删边翻页不能配合 skip：删除后剩余文档前移，skip 会跳过尚未清理的文档（每页漏掉一半）。
    // 改为始终取第一页，直到取空为止；并加页数上限兜底，避免异常时死循环。
    function load(round) {
      if (round > 200) return false
      return col.where({ deletedAt: db.command.gt(0) }).limit(20).get().then(function (res) {
        const data = (res && res.data) || []
        if (!data.length) return true
        const tasks = data.map(function (doc) {
          return col.doc(doc._id).remove().then(function () { return true }).catch(function () { return false })
        })
        return Promise.all(tasks).then(function (results) {
          if (results.some(function (ok) { return !ok })) return false
          return data.length < 20 ? true : load(round + 1)
        })
      })
    }
    return load(0)
  }, true).then(function (result) {
    return !!result
  }).catch(function () {
    return false
  })
}

function pushAll(records) {
  const list = Array.isArray(records) ? records : Object.keys(records || {}).map(function (id) { return records[id] })
  const QUEUE_SIZE = 8
  let index = 0
  let allSucceeded = true
  function next() {
    if (index >= list.length) return Promise.resolve(allSucceeded)
    const batch = list.slice(index, index + QUEUE_SIZE)
    index += QUEUE_SIZE
    return Promise.all(batch.map(pushOne)).then(function (results) {
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
    // _id 游标分页：显式 orderBy 保证顺序确定，按上一页最后一条的 _id 续拉，
    // 避免 skip 深分页在并发写入时漏读/重读，也免去深分页的线性扫描开销。
    function load(lastId) {
      const query = lastId ? col.where({ _id: db.command.gt(lastId) }) : col
      return query.orderBy('_id', 'asc').limit(PAGE).get().then(function (res) {
        const data = (res && res.data) || []
        data.forEach(function (doc) {
          const rec = clean(doc)
          if (rec.id && rec.updatedAt) out.push(rec)
        })
        return data.length < PAGE ? out : load(data[data.length - 1]._id)
      })
    }
    return load('')
  }, true).then(function (result) {
    return result || null
  })
}

// 增量拉取：只取 updatedAt 晚于上次成功同步水位的文档（含删除墓碑）。
function pullSince(since) {
  return withDb(function (db) {
    const col = db.collection(COLL)
    const out = []
    const PAGE = 20
    const minTs = Number(since) || 0
    // 同 pullAll：按 _id 游标分页，叠加 updatedAt 水位过滤，避免 skip 深分页漏读/重读。
    function load(lastId) {
      const where = lastId
        ? { updatedAt: db.command.gt(minTs), _id: db.command.gt(lastId) }
        : { updatedAt: db.command.gt(minTs) }
      return col.where(where).orderBy('_id', 'asc').limit(PAGE).get().then(function (res) {
        const data = (res && res.data) || []
        data.forEach(function (doc) {
          const rec = clean(doc)
          if (rec.id && rec.updatedAt) out.push(rec)
        })
        return data.length < PAGE ? out : load(data[data.length - 1]._id)
      })
    }
    return load('')
  }, true).then(function (result) {
    return result || null
  })
}

module.exports = {
  enabled: enabled,
  pushOne: pushOne,
  pushAll: pushAll,
  pullAll: pullAll,
  pullSince: pullSince,
  purgeCloudDeleted: purgeCloudDeleted
}
