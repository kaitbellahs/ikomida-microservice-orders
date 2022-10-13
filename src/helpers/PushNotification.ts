import { Domain, Types, Utils } from '@ikomida/shared-backend'

export default class PushNotification {
  logger
  constructor(logger: Utils.Logger) {
    this.logger = logger
  }

  async sendNotification(input: Types.Classes.CNotification, orderId?: string, contractId?: string, userId?: string) {
    const notification: Types.Classes.CNotification = Types.Classes.CNotification.fromObject(input)
    const message = new Types.Classes.CNotificationPayload()
    message.notification = notification
    message.data = new Types.Classes.CNotificationData()
    message.data.method = notification.method
    message.data.uri = notification.uri
    message.data.logon = notification.logon
    message.data.payload = orderId
    const payload = new Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject>()
    payload.method = 'send'
    const payloadObject = new Types.Classes.CAMQPPayloadObject()
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
