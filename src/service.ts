import express from 'express'
import Vendor from './controllers/Vendor.js'
import User from './controllers/User.js'
import { BackendTypes, Types, Utils } from '@ikomida/shared-backend'

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
let { name } = require('../package.json')
name = name
  .replace(/^(@\S+\/)?(svelte-)?(\S+)/, '$3')
  .replace(/^\w/, (m: string) => m.toUpperCase())
  .replace(/-\w/g, (m: string[]) => m[1].toUpperCase())
const logger = Utils.Logger.getInstance(name)

let vendor = new Vendor(logger)
let user = new User(logger)
const app = express()
Utils.System.setExpressResponse(app)
app.disable('x-powered-by')
app.use(express.json())
const port = process?.env?.PORT || 80

app.get('/orders/:timestamp', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  // const uri = req?.originalUrl?.split('/')
  // const isHistory = uri?.at(-1) === 'history'
  let payload
  switch (identity?.role) {
    case Types.Types.TRoles.CLIENT:
      payload = await user.getOrders(
        identity,
        Number(req.params?.timestamp) ?? 0,
        req.query as Types.Interfaces.IMetadata
      )
      break
    case Types.Types.TRoles.ADMIN:
    case Types.Types.TRoles.VENDOR:
    case Types.Types.TRoles.STAFF:
      payload = await vendor.getOrders(
        identity,
        Number(req.params?.timestamp) ?? 0,
        req.query as Types.Interfaces.IMetadata
      )
      break
  }
  res.status(payload?.success ? 200 : 404).sendResponse(payload)
})

app.get('/order/:id', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  let payload
  switch (identity?.role) {
    case Types.Types.TRoles.CLIENT:
      payload = await user.getOrder(identity, req.params?.id ?? '')
      break
    case Types.Types.TRoles.ADMIN:
    case Types.Types.TRoles.VENDOR:
    case Types.Types.TRoles.STAFF:
      payload = await vendor.getOrder(identity, req.params?.id ?? '')
      break
  }
  res.status(payload?.success ? 200 : 404).sendResponse(payload)
})

app.get('/ordersCount', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  let payload
  switch (identity?.role) {
    case Types.Types.TRoles.CLIENT:
      payload = await user.getOrdersCount(identity)
      break
    case Types.Types.TRoles.ADMIN:
    case Types.Types.TRoles.VENDOR:
    case Types.Types.TRoles.STAFF:
      payload = await vendor.getOrdersCount(identity)
      break
  }
  res.status(payload?.success ? 200 : 404).sendResponse(payload)
})

app.post('/order', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  const payload = await user.newOrder(identity, req.body)
  res.status(payload?.success ? 201 : 200).sendResponse(payload)
})

app.put('/order', async (req, res) => {
  const identity: Types.Classes.CUser = Types.Classes.CUser.fromObject(req.headers?.identity)
  let payload
  switch (identity?.role) {
    case Types.Types.TRoles.CLIENT:
      payload = await user.changeOrderStatus(identity, req.body)
      break
    case Types.Types.TRoles.ADMIN:
    case Types.Types.TRoles.VENDOR:
    case Types.Types.TRoles.STAFF:
      payload = await vendor.changeOrderStatus(identity, req.body)
      break
  }
  res.status(payload?.success ? 200 : 404).sendResponse(payload)
})

app.all('*', async (req, res) => {
  logger.error(`Orders endpoint: "${req?.url}" not found:`)
  res.status(404).sendResponse({ error: 'NOT FOUND' })
})

vendor = new Vendor(logger)
user = new User(logger)

app.listen(port, () => {
  logger.info(`${name} listening at http://localhost:${port}`)
})
