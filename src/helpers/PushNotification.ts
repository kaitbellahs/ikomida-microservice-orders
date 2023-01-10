import { Domain, Utils } from '@ikomida/shared-backend'
import { Classes } from '@ikomida/shared-types'

export default class PushNotification {
  logger
  constructor(logger: Utils.Logger) {
    this.logger = logger
  }

  async sendNotification(
    input: Classes.CNotification,
    orderId?: string,
    contractId?: string,
    userId?: string,
    ...args: any[]
  ) {
    const notification: Classes.CNotification = Classes.CNotification.fromObject(input)
    const managedNotification = new Utils.Notification(notification, ...args)
    const message = new Classes.CNotificationPayload()
    message.notification = managedNotification
    message.data = new Classes.CNotificationData()
    message.data.method = managedNotification.method
    message.data.uri = managedNotification.uri
    message.data.logon = managedNotification.logon
    message.data.payload = orderId
    const payload = new Classes.CAMQPPayload<Classes.CAMQPPayloadObject>()
    payload.method = 'send'
    const payloadObject = new Classes.CAMQPPayloadObject()
    payloadObject.message = message
    payloadObject.contractId = contractId
    if (userId) {
      payloadObject.userId = userId
    }
    payload.object = payloadObject

    const amqp = new Domain.RabbitMQ(this.logger)
    await amqp?.publish(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, payload)
    await amqp?.close()
  }
}
