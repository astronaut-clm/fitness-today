// 训练记录云端同步：每条记录独立文档；删除即物理删除云端文档，不留墓碑
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
      // 删除记录 = 云端物理删除（文档不存在也视为成功）
      ? col.doc(record.id).remove()
      : col.doc(record.id).set({ data: clean(record) })
    return op.then(function () {
      return true
    }).catch(function () { return false })
  }).then(function (result) { return !!result })
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
    // _id 游标分页，避免 skip 深分页在并发写入时漏读/重读
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

function pullSince(since) {
  return withDb(function (db) {
    const col = db.collection(COLL)
    const out = []
    const PAGE = 20
    const minTs = Number(since) || 0
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
  pullSince: pullSince
}
