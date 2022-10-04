import { Domain, Utils, BackendTypes, Types, Logics, DBModels } from '@ikomida/shared-backend'

const orderOptions = [
  Types.Types.TOrderStatus.ACCEPTED,
  Types.Types.TOrderStatus.WAITING_DELIVERY,
  Types.Types.TOrderStatus.IN_DELIVERY,
  Types.Types.TOrderStatus.DELIVERED,
  Types.Types.TOrderStatus.CANCELED
]
const orderFinishedOptions = [Types.Types.TOrderStatus.DELIVERED, Types.Types.TOrderStatus.CANCELED]
export default class Orders {
  logger
  limit = 10

  constructor(logger: Utils.Logger) {
    this.logger = logger
  }

  async getOrders(identity: Types.Classes.CUser, timestamp = 0) {
    const where =
      timestamp && timestamp != 0 && Number(Logics.Finances.toNumber(timestamp)) == timestamp
        ? {
            createdAt: {
              [Domain.SqlDB.Op.lt]: new Date(Number(Logics.Finances.toNumber(timestamp)))
            }
          }
        : {}
    const contractModel = await DBModels.ContractModel.findOne({
      where: {
        ikomidaID: identity.ikomidaID
      },
      include: [
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.ADMIN, BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF]
            }
          }
        },
        {
          model: DBModels.OrderModel,
          required: false,
          include: [
            {
              model: DBModels.OrderProductModel,
              required: false,
              include: [
                {
                  model: DBModels.OrderProductOptionModel,
                  required: false
                }
              ]
            },
            {
              model: DBModels.UserModel,
              required: true
            },
            {
              model: DBModels.UserPaymentModel,
              required: false,
              include: [
                {
                  model: DBModels.UserCreditCardModel,
                  required: false
                }
              ]
            },
            {
              model: DBModels.AddressModel,
              required: false
            },
            {
              model: DBModels.CouponModel,
              required: false
            }
          ],
          order: [['createdAt', 'DESC']],
          limit: this.limit,
          where
        }
      ]
    })
    if (!contractModel) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_INVALID_CONTRACT)
      return error.logAndReturn(this.logger)
    }
    const orderModels = contractModel?.orders
    const orders = orderModels?.map(orderModel => {
      let userCreditCard
      try {
        userCreditCard = orderModel?.userPayment?.userCreditCard
      } catch (error: any) {
        this.logger.error(error)
      }
      const user = Types.Classes.CUser.init(
        '',
        orderModel.user?.name ?? '-',
        orderModel.user?.lastName ?? '-',
        orderModel.user?.identity ?? '-',
        orderModel.user?.email ?? '-',
        orderModel.user?.phone ?? '-',
        String(orderModel.user?.areaCode),
        ''
      )
      const products =
        orderModel.orderProducts?.map(orderProduct => {
          const orderProductOptions =
            orderProduct.orderProductOptions?.map(orderProductOption => {
              return Types.Classes.CProductOption.init(
                orderProductOption.name ?? '-',
                false,
                orderProductOption.price ?? 0,
                orderProductOption.units ?? 0,
                0,
                undefined,
                orderProductOption.productOptionId
              )
            }) ?? []
          return Types.Classes.CProduct.init(
            orderProduct?.title ?? '-',
            orderProduct?.price ?? 0,
            orderProduct?.discount ?? 0,
            orderProduct?.discountType ?? Types.Types.TDiscount.NO,
            orderProduct?.quantity ?? 0,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            orderProductOptions,
            undefined,
            orderProduct?.productId
          )
        }) ?? []
      const address = Types.Classes.CAddress.init(
        orderModel.address?.postalCode ?? '-',
        orderModel.address?.street ?? '-',
        orderModel.address?.neighborhood ?? '-',
        orderModel.address?.city ?? '-',
        orderModel.address?.stat ?? '-',
        orderModel.address?.number,
        orderModel.address?.complement,
        orderModel.address?.kind,
        orderModel.address?.reference,
        orderModel.address?.distance,
        orderModel.address?.duration
      )

      const payment = Types.Classes.CPaymentMethod.init(
        orderModel?.paymentMethodType ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
        userCreditCard?.brand ?? 'Unknown',
        userCreditCard?.lastDigits ?? '',
        userCreditCard?.firstDigits ?? ''
      )

      const preparation = Types.Classes.COrderPreparation.init(
        (orderModel?.preparationMin ?? 0) * 60,
        (orderModel?.preparationMax ?? 0) * 60
      )

      const coupon = Types.Classes.CCoupon.init(
        orderModel.coupon?.name ?? '-',
        orderModel.coupon?.value ?? 0,
        orderModel?.coupon?.valueType ?? Types.Types.TDiscount.NO
      )

      const order = Types.Classes.COrder.init(
        orderModel.subtotal ?? 0,
        orderModel.discount ?? 0,
        orderModel.delivery ?? 0,
        products,
        address,
        orderModel.paymentMethodType ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
        preparation,
        coupon,
        orderModel.createdAt,
        orderModel.customID,
        orderModel.status,
        orderModel.finishedAt,
        payment,
        user,
        orderModel.id,
        orderModel?.createdAt.getTime()
      )
      return order
    })
    return new Utils.Return(
      true,
      orders?.filter(order => order !== null)?.sort((item1, item2) => (item2?.timestamp ?? 0) - (item1?.timestamp ?? 0))
    )
  }

  async changeOrderStatus(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.COrder = Types.Classes.COrder.fromObject(input)
      if (!payload?.status || !payload?.id) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WRONG_STATUS)
        return error.logAndReturn(this.logger)
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.ADMIN, BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF]
              }
            }
          },
          {
            model: DBModels.OrderModel,
            required: true,
            where: {
              id: payload?.id
            },
            include: [DBModels.UserPaymentModel, DBModels.UserModel]
          }
        ]
      })
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_CONTRACT)
        return error.logAndReturn(this.logger)
      }
      const userModels = contractModel.users
      if (!userModels || userModels.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_USER)
        return error.logAndReturn(this.logger)
      }
      if (!payload.id || (payload.status && !orderOptions.includes(payload.status))) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_MISSING_OBJECT
        )
        return error.logAndReturn(this.logger)
      }
      const orders = await contractModel.orders
      let order = null
      if (!orders || orders.length !== 1) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_ORDER_NOT_FOUND
        )
        return error.logAndReturn(this.logger)
      }
      order = orders[0]
      if (
        order.userPayment &&
        order.userPayment?.status !== Types.Types.TPagSeguroPaymentStatus.PAID &&
        order.paymentMethodType === Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WAITING_PAYMENT
        )
        return error.logAndReturn(this.logger)
      }
      if (
        payload.status === Types.Types.TOrderStatus.CANCELED &&
        order.userPayment &&
        order.userPayment?.status !== Types.Types.TPagSeguroPaymentStatus.CANCELED &&
        order.paymentMethodType === Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        try {
          const paymentPayload = new Types.Classes.CAMQPPayload<string>({
            method: 'cancelPayment',
            object: order.userPayment?.id
          })
          const amqp = new Domain.RabbitMQ(this.logger)
          await amqp?.publish(Domain.RabbitMQ.PAYMENT_QUEUE, paymentPayload)
          await amqp?.close()
        } catch (exception: any) {
          new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_PAYMENT_EXCEPTION,
            exception?.message
          ).log(this.logger)
          this.logger.error(exception)
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_ERROR)
          return error.logAndReturn(this.logger)
        }
      }
      if (payload.status && orderFinishedOptions.includes(payload.status)) {
        order.finishedAt = new Date()
      }
      order.status = payload.status
      await order.save()
      try {
        const pNModel = await order.user?.$get('pN')
        if (pNModel) {
          const notification = new Utils.Notification(Utils.Notification.ORDER_UPDATED)
          const message = new Types.Classes.CNotificationPayload()
          message.notification = notification
          message.data = new Types.Classes.CNotificationData()
          message.data.method = notification.method
          message.data.uri = notification.uri
          message.data.logon = notification.logon
          message.data.payload = order.id
          const payload = new Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject>()
          payload.method = 'send'
          const payloadObject = new Types.Classes.CAMQPPayloadObject()
          payloadObject.message = message
          payloadObject.userId = order.user?.id
          payloadObject.contractId = contractModel?.id
          payload.object = payloadObject
          const amqp = new Domain.RabbitMQ(this.logger)
          await amqp?.publish(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, payload)
          await amqp?.close()
        }
      } catch (exception: any) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
          exception?.message
        )
        error.log(this.logger)
      }
      return new Utils.Return(
        true,
        Types.Classes.COrder.fromObject({ id: order.id, status: order.status, finishedAt: order.finishedAt })
      )
    } catch (exception: any) {
      const error = new Utils.iKomidaError(
        Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
        exception?.message
      )
      return error.logAndReturn(this.logger)
    }
  }

  async getOrdersCount(identity: Types.Classes.CUser) {
    const role = BackendTypes.Roles.valueOf(identity.role)
    if (!role || ![BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF].includes(role)) {
      return new Utils.Return(true, 0)
    }
    const contractModel = await DBModels.ContractModel.findOne({
      where: {
        ikomidaID: identity.ikomidaID
      },
      include: [
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.ADMIN, BackendTypes.Roles.VENDOR, BackendTypes.Roles.STAFF]
            }
          }
        },
        {
          model: DBModels.OrderModel,
          required: false
        }
      ]
    })
    if (!contractModel) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_COUNT_INVALID_CONTRACT)
      return error.logAndReturn(this.logger)
    }
    return new Utils.Return(true, contractModel?.orders?.length ?? 0)
  }
}
