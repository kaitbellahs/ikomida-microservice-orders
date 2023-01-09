import { Domain, Utils, DBModels } from '@ikomida/shared-backend'
import { IiKomidaErrorModel } from '@ikomida/shared-backend/lib/src/Utils/iKomidaError'
import { Finances, Validations } from '@ikomida/shared-logics'
import { Classes, Interfaces, Types } from '@ikomida/shared-types'
import PushNotification from '../helpers/PushNotification.js'

const orderOptions: Interfaces.IRecord<string, Types.TOrderType[]> = {
  [Types.TOrderType.DELIVERY.id]: [
    Types.TOrderStatus.ACCEPTED,
    Types.TOrderStatus.WAITING_DELIVERY,
    Types.TOrderStatus.IN_DELIVERY,
    Types.TOrderStatus.DELIVERED,
    Types.TOrderStatus.CANCELED
  ],
  [Types.TOrderType.LOCAL.id]: [
    Types.TOrderStatus.ACCEPTED,
    Types.TOrderStatus.WAITING_LOCAL,
    Types.TOrderStatus.IN_TABLE_DELIVERY,
    Types.TOrderStatus.DELIVERED,
    Types.TOrderStatus.CANCELED
  ],
  [Types.TOrderType.PICKUP.id]: [
    Types.TOrderStatus.ACCEPTED,
    Types.TOrderStatus.WAITING_PICKUP,
    Types.TOrderStatus.DELIVERED,
    Types.TOrderStatus.CANCELED
  ]
}
const orderFinishedOptions = [Types.TOrderStatus.DELIVERED, Types.TOrderStatus.CANCELED]
export default class Orders {
  logger
  limit = 10

  constructor(logger: Utils.Logger) {
    this.logger = logger
  }

  GET_ORDER_INVALIDE_UUID: IiKomidaErrorModel = {
    code: 'IMO001',
    message: 'O pedido não foi localizado.'
  }
  GET_ORDER_MORE_THEN_ONE: IiKomidaErrorModel = {
    code: 'IMO002',
    message: 'O pedido não foi localizado.'
  }

  async getOrders(identity: Classes.CUser, timestamp = 0, query?: Interfaces.IMetadata) {
    let where = {}
    const orderType = Types.TOrderType.valueOf(query?.orderType ?? '')
    if (orderType) {
      where = {
        orderType
      }
    }
    where =
      timestamp && timestamp != 0 && Number(Finances.toNumber(timestamp)) == timestamp
        ? {
            ...where,
            createdAt: {
              [Domain.SqlDB.Op.lt]: new Date(Number(Finances.toNumber(timestamp)))
            }
          }
        : where
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
              [Domain.SqlDB.Op.in]: [Types.TRoles.ADMIN, Types.TRoles.VENDOR, Types.TRoles.STAFF]
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
              required: true,
              paranoid: false,
              //TODO: get totals from db
              include: [
                {
                  model: DBModels.OrderModel,
                  attributes: ['id', 'orderType', 'subtotal', 'delivery', 'discount', 'tip'],
                  required: false,
                  where: {
                    status: Types.TOrderStatus.DELIVERED
                  }
                }
              ]
            },
            {
              model: DBModels.UserPaymentModel,
              required: false,
              paranoid: false,
              include: [
                {
                  model: DBModels.UserCreditCardModel,
                  required: false,
                  paranoid: false
                }
              ]
            },
            {
              model: DBModels.AddressModel,
              required: false,
              paranoid: false
            },
            {
              model: DBModels.CouponModel,
              required: false,
              paranoid: false
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
      const ordersTotal = orderModel.user?.orders?.map(
        order => Number(order.subtotal) + Number(order.delivery) - Number(order.discount)
      )
      const billing = (ordersTotal?.length ?? 0) > 0 ? ordersTotal?.reduce((a, b) => a + b) : 0
      const user = Classes.CUser.init(
        orderModel.user?.role ?? Types.TRoles.CLIENT,
        orderModel.user?.name ?? '-',
        orderModel.user?.lastName ?? '-',
        orderModel.user?.identity ?? '-',
        orderModel.user?.email ?? '-',
        orderModel.user?.phone ?? '-',
        String(orderModel.user?.areaCode),
        '',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        orderModel.user?.orders?.length ?? 0,
        billing
      )
      const products =
        orderModel.orderProducts?.map(orderProduct => {
          const orderProductOptions =
            orderProduct.orderProductOptions?.map(orderProductOption => {
              return Classes.CProductOption.init(
                orderProductOption.name ?? '-',
                false,
                orderProductOption.price ?? 0,
                orderProductOption.units ?? 0,
                0,
                undefined,
                orderProductOption.productOptionId
              )
            }) ?? []
          return Classes.CProduct.init(
            orderProduct?.title ?? '-',
            orderProduct?.price ?? 0,
            orderProduct?.discount ?? 0,
            orderProduct?.discountType ?? Types.TDiscount.NO,
            orderProduct?.quantity ?? 0,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            orderProductOptions,
            undefined,
            orderProduct.observation,
            undefined,
            undefined,
            undefined,
            undefined,
            orderProduct?.productId
          )
        }) ?? []
      const address = Classes.CAddress.init(
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

      const payment = Classes.CPaymentMethod.init(
        orderModel?.paymentMethodType ?? Types.TPaymentMethod.CASH_ON_DELIVERY,
        userCreditCard?.brand ?? 'Unknown',
        userCreditCard?.lastDigits ?? '',
        userCreditCard?.firstDigits ?? ''
      )

      const preparation = Classes.COrderPreparation.init(
        (orderModel?.preparationMin ?? 0) * 60,
        (orderModel?.preparationMax ?? 0) * 60
      )

      const coupon = Classes.CCoupon.init(
        orderModel.coupon?.name ?? '-',
        orderModel.coupon?.value ?? 0,
        orderModel.coupon?.minValue ?? 0,
        orderModel?.coupon?.valueType ?? Types.TDiscount.NO
      )

      const order = Classes.COrder.init(
        orderModel.subtotal ?? 0,
        orderModel.discount ?? 0,
        orderModel.delivery ?? 0,
        products,
        address,
        orderModel.paymentMethodType ?? Types.TPaymentMethod.CASH_ON_DELIVERY,
        preparation,
        coupon,
        orderModel.createdAt,
        orderModel.customID,
        orderModel.status,
        orderModel.finishedAt,
        payment,
        user,
        Classes.CLocation.fromObject({
          latitude: orderModel?.coordinates?.coordinates?.[0],
          longitude: orderModel?.coordinates?.coordinates?.[1]
        }),
        orderModel.orderType,
        orderModel.tip,
        orderModel.table,
        orderModel.change,
        orderModel.id,
        orderModel?.createdAt.getTime()
      )
      return order
    })
    return new Classes.Return(
      true,
      orders?.filter(order => order !== null)?.sort((item1, item2) => (item2?.timestamp ?? 0) - (item1?.timestamp ?? 0))
    )
  }

  async getOrder(identity: Classes.CUser, id: string) {
    try {
      if (!Validations.validateUUID(id)) {
        throw new Utils.iKomidaError(this.GET_ORDER_INVALIDE_UUID)
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
                [Domain.SqlDB.Op.in]: [Types.TRoles.ADMIN, Types.TRoles.VENDOR, Types.TRoles.STAFF]
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
                required: true,
                paranoid: false,
                //TODO: get totals from db
                include: [
                  {
                    model: DBModels.OrderModel,
                    required: false,
                    where: {
                      status: Types.TOrderStatus.DELIVERED
                    }
                  }
                ]
              },
              {
                model: DBModels.UserPaymentModel,
                required: false,
                paranoid: false,
                include: [
                  {
                    model: DBModels.UserCreditCardModel,
                    required: false,
                    paranoid: false
                  }
                ]
              },
              {
                model: DBModels.AddressModel,
                required: false,
                paranoid: false
              },
              {
                model: DBModels.CouponModel,
                required: false,
                paranoid: false
              }
            ],
            limit: 2,
            where: {
              id
            }
          }
        ]
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_INVALID_CONTRACT)
      }
      const orderModels = contractModel?.orders
      if (orderModels?.length !== 1) {
        throw new Utils.iKomidaError(this.GET_ORDER_MORE_THEN_ONE)
      }
      const orderModel = orderModels[0]
      let userCreditCard
      try {
        userCreditCard = orderModel?.userPayment?.userCreditCard
      } catch (error: any) {
        this.logger.error(error)
      }

      const ordersTotal = orderModel.user?.orders?.map(
        order => Number(order.subtotal) + Number(order.delivery) - Number(order.discount)
      )
      const billing = (ordersTotal?.length ?? 0) > 0 ? ordersTotal?.reduce((a, b) => a + b) : 0
      const user = Classes.CUser.init(
        orderModel.user?.role ?? Types.TRoles.CLIENT,
        orderModel.user?.name ?? '-',
        orderModel.user?.lastName ?? '-',
        orderModel.user?.identity ?? '-',
        orderModel.user?.email ?? '-',
        orderModel.user?.phone ?? '-',
        String(orderModel.user?.areaCode),
        '',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        orderModel.user?.orders?.length ?? 0,
        billing
      )
      const products =
        orderModel.orderProducts?.map(orderProduct => {
          const orderProductOptions =
            orderProduct.orderProductOptions?.map(orderProductOption => {
              return Classes.CProductOption.init(
                orderProductOption.name ?? '-',
                false,
                orderProductOption.price ?? 0,
                orderProductOption.units ?? 0,
                0,
                undefined,
                orderProductOption.productOptionId
              )
            }) ?? []
          return Classes.CProduct.init(
            orderProduct?.title ?? '-',
            orderProduct?.price ?? 0,
            orderProduct?.discount ?? 0,
            orderProduct?.discountType ?? Types.TDiscount.NO,
            orderProduct?.quantity ?? 0,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            orderProductOptions,
            undefined,
            orderProduct.observation,
            undefined,
            undefined,
            undefined,
            undefined,
            orderProduct?.productId
          )
        }) ?? []
      const address = Classes.CAddress.init(
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

      const payment = Classes.CPaymentMethod.init(
        orderModel?.paymentMethodType ?? Types.TPaymentMethod.CASH_ON_DELIVERY,
        userCreditCard?.brand ?? 'Unknown',
        userCreditCard?.lastDigits ?? '',
        userCreditCard?.firstDigits ?? ''
      )

      const preparation = Classes.COrderPreparation.init(
        (orderModel?.preparationMin ?? 0) * 60,
        (orderModel?.preparationMax ?? 0) * 60
      )

      const coupon = Classes.CCoupon.init(
        orderModel.coupon?.name ?? '-',
        orderModel.coupon?.value ?? 0,
        orderModel.coupon?.minValue ?? 0,
        orderModel?.coupon?.valueType ?? Types.TDiscount.NO
      )

      const order = Classes.COrder.init(
        orderModel.subtotal ?? 0,
        orderModel.discount ?? 0,
        orderModel.delivery ?? 0,
        products,
        address,
        orderModel.paymentMethodType ?? Types.TPaymentMethod.CASH_ON_DELIVERY,
        preparation,
        coupon,
        orderModel.createdAt,
        orderModel.customID,
        orderModel.status,
        orderModel.finishedAt,
        payment,
        user,
        Classes.CLocation.fromObject({
          latitude: orderModel?.coordinates?.coordinates?.[0],
          longitude: orderModel?.coordinates?.coordinates?.[1]
        }),
        orderModel.orderType,
        orderModel.tip,
        orderModel.table,
        orderModel.change,
        orderModel.id,
        orderModel?.createdAt.getTime()
      )
      return new Classes.Return(true, order)
    } catch (exception: any) {
      let error: Utils.iKomidaError
      if (exception instanceof Utils.iKomidaError) {
        error = exception
      } else {
        error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
          exception
        )
      }
      return error.logAndReturn(this.logger)
    }
  }

  async changeOrderStatus(identity: Classes.CUser, input: any) {
    try {
      const payload: Classes.COrder = Classes.COrder.fromObject(input)
      if (!payload?.status || !payload?.id) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WRONG_STATUS)
        return error.logAndReturn(this.logger)
      }
      const contractModel = await DBModels.ContractModel.findOne({
        subQuery: false,
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
                [Domain.SqlDB.Op.in]: [Types.TRoles.ADMIN, Types.TRoles.VENDOR, Types.TRoles.STAFF]
              }
            }
          },
          {
            model: DBModels.OrderModel,
            required: true,
            where: {
              id: payload?.id
            },
            include: [
              {
                model: DBModels.UserPaymentModel,
                required: false
              },
              {
                model: DBModels.UserModel,
                required: true,
                include: [
                  {
                    model: DBModels.PNModel,
                    required: false
                  }
                ]
              }
            ]
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
      const orders = contractModel.orders
      let order = null
      if (!orders || orders.length !== 1) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_ORDER_NOT_FOUND
        )
        return error.logAndReturn(this.logger)
      }
      order = orders[0]
      if (
        !payload.id ||
        !order.orderType?.id ||
        (payload.status && !orderOptions[order.orderType.id]?.includes(payload.status))
      ) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_MISSING_OBJECT
        )
        return error.logAndReturn(this.logger)
      }
      if (
        order.userPayment &&
        order.userPayment?.status !== Types.TPagSeguroPaymentStatus.PAID &&
        order.paymentMethodType === Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WAITING_PAYMENT
        )
        return error.logAndReturn(this.logger)
      }
      if (
        payload.status === Types.TOrderStatus.CANCELED &&
        order.userPayment &&
        order.userPayment?.status !== Types.TPagSeguroPaymentStatus.CANCELED &&
        order.paymentMethodType === Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        try {
          const paymentPayload = new Classes.CAMQPPayload<string>({
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
        const pNModel = order.user?.pN
        if (pNModel) {
          const pn = new PushNotification(this.logger)
          await pn.sendNotification(
            Utils.Notification.USER_ORDER_UPDATED,
            order?.id,
            contractModel?.id,
            order?.user?.id,
            payload.status.name
          )
        }
      } catch (exception: any) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
          exception?.message
        )
        error.log(this.logger)
      }
      return new Classes.Return(
        true,
        Classes.COrder.fromObject({ id: order.id, status: order.status, finishedAt: order.finishedAt })
      )
    } catch (exception: any) {
      const error = new Utils.iKomidaError(
        Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
        exception?.message
      )
      return error.logAndReturn(this.logger)
    }
  }

  async getOrdersCount(identity: Classes.CUser) {
    const role = identity.role
    if (!role || ![Types.TRoles.VENDOR, Types.TRoles.STAFF].includes(role)) {
      return new Classes.Return(true, 0)
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
              [Domain.SqlDB.Op.in]: [Types.TRoles.ADMIN, Types.TRoles.VENDOR, Types.TRoles.STAFF]
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
    return new Classes.Return(true, contractModel?.orders?.length ?? 0)
  }
}
