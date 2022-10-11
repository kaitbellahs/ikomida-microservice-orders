import { Domain, Utils, BackendTypes, Logics, Types, DBModels, Helpers, slugging } from '@ikomida/shared-backend'
import { v4 as uuidv4 } from 'uuid'
import { IiKomidaErrorModel } from '@ikomida/shared-backend/lib/Utils/iKomidaError'

export default class Orders {
  logger
  limit = 10

  constructor(logger: Utils.Logger) {
    this.logger = logger
  }

  private IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCT_OPTIONS_NOT_EXIST: IiKomidaErrorModel = {
    code: 'POS001',
    message: 'As opções do produto que você selecionou não foram localizadas!'
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
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT]
            }
          },
          include: [
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
        }
      ]
    })
    if (!contractModel) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_INVALID_CONTRACT)
      return error.logAndReturn(this.logger)
    }
    const userModels = contractModel?.users
    if (!userModels || userModels.length !== 1) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_INVALID_USER)
      return error.logAndReturn(this.logger)
    }
    const orderModels = userModels?.[0].orders
    const orders = orderModels?.map(orderModel => {
      const userCreditCard = orderModel.userPayment?.userCreditCard

      const products =
        orderModel.orderProducts?.map(orderProduct => {
          const orderProductOptions =
            orderProduct.orderProductOptions?.map(orderProductOption => {
              return Types.Classes.CProductOption.init(
                orderProductOption.name ?? '-',
                false,
                orderProductOption.price ?? 0,
                orderProductOption.units ?? 0,
                0
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
            orderProductOptions
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
        orderModel.paymentMethodType ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
        userCreditCard?.brand ?? 'Unknown',
        userCreditCard?.lastDigits ?? '',
        userCreditCard?.firstDigits ?? ''
      )

      const preparation = Types.Classes.COrderPreparation.init(
        (orderModel.preparationMin ?? 0) * 60,
        (orderModel.preparationMax ?? 0) * 60
      )

      const coupon = Types.Classes.CCoupon.init(
        orderModel.coupon?.name ?? '-',
        orderModel.coupon?.value ?? 0,
        orderModel.coupon?.valueType ?? Types.Types.TDiscount.NO
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
        undefined,
        orderModel.id,
        orderModel.createdAt.getTime()
      )
      return order
    })
    return new Utils.Return(
      true,
      orders?.filter(order => order !== null)?.sort((item1, item2) => (item2?.timestamp ?? 0) - (item1?.timestamp ?? 0))
    )
  }

  async newOrder(identity: Types.Classes.CUser, input: any) {
    let transaction: Domain.SqlDB.Transaction | undefined = undefined
    try {
      transaction = await Domain.SqlDB.sequelize.transaction({
        logging: console.log,
        autocommit: false,
        isolationLevel: Domain.SqlDB.Transaction.ISOLATION_LEVELS.READ_UNCOMMITTED
      })
      const payload: Types.Classes.COrder = Types.Classes.COrder.fromObject(input)
      const productsIDs = [...new Set(payload?.products?.map(item => item.id))]
      const productOptionsIDs: { productId: string | undefined; optionsIds: Set<string> }[] = []
      for (const product of payload?.products ?? []) {
        productOptionsIDs.push({
          productId: product.id,
          optionsIds: new Set(
            (product.options ?? [])
              .filter(
                productOption => productOption.id !== '' && productOption.id !== null && productOption.id !== undefined
              )
              .map((productOption: Types.Classes.CProductOption) => productOption.id!)
          )
        })
      }
      const includeCoupon = payload?.coupon?.id
        ? [
          {
            model: DBModels.CouponModel,
            required: false,
            where: {
              id: payload?.coupon?.id,
              quantity: {
                [Domain.SqlDB.Op.gt]: 0
              },
              validity: {
                [Domain.SqlDB.Op.gt]: new Date()
              }
            },
            limit: 2
          }
        ]
        : []
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID
        },
        logging: console.log,
        transaction,
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity?.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT]
              }
            },
            include: [
              {
                model: DBModels.UserCreditCardModel,
                where: {
                  id: payload.payment?.id
                },
                required: false
              },
              {
                model: DBModels.AddressModel,
                where: {
                  id: payload.address?.id
                },
                required: false
              }
            ]
          },
          {
            model: DBModels.PlanModel,
            required: true
          },
          {
            model: DBModels.VendorSettingsModel,
            required: false,
            include: [
              {
                model: DBModels.VendorPaymentGatewayModel,
                required: false
              }
            ]
          },
          {
            model: DBModels.ProductModel,
            where: {
              id: {
                [Domain.SqlDB.Op.in]: productsIDs
              }
            },
            include: [
              {
                model: DBModels.ProductOptionModel,
                required: false,
                where: {
                  id: {
                    [Domain.SqlDB.Op.in]: [...productOptionsIDs.flatMap(product => [...product.optionsIds])]
                  }
                }
              }
            ],
            required: false
          },
          {
            model: DBModels.ContractPaymentSignatureModel,
            required: false
          },
          {
            model: DBModels.PNModel,
            where: {
              role: BackendTypes.Roles.VENDOR
            },
            required: false
          },
          {
            model: DBModels.OrderModel,
            where: {
              createdAt: {
                [Domain.SqlDB.Op.gt]: Domain.SqlDB.Column('contractPaymentSignature.lastDueDate')
              },
              status: {
                [Domain.SqlDB.Op.notIn]: [Types.Types.TOrderStatus.CANCELED.id]
              }
            },
            required: false
          },
          ...includeCoupon
        ]
      })
      if (!contractModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_CONTRACT)
      }

      const ordersLimit = contractModel?.plan?.orders ?? -1
      if (ordersLimit !== 0 && (contractModel?.orders?.length ?? 0) >= ordersLimit) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_LIMIT_EXCEEDED, ordersLimit)
      }

      const ordersTotal = contractModel?.orders?.map(
        order => Number(order?.subtotal) + Number(order?.delivery) - Number(order?.discount)
      )
      const billing = (ordersTotal?.length ?? 0) > 0 ? ordersTotal?.reduce((a, b) => a + b) : 0
      const billingLimit = contractModel?.plan?.billing ?? 0 ?? -1
      if (billingLimit !== 0 && (billing ?? 0) >= billingLimit) {
        throw new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_BILLING_LIMIT_EXCEEDED,
          billingLimit
        )
      }
      const vendorSettingsModel = contractModel?.vendorSettings
      if (!vendorSettingsModel) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_EMPTY)
      }
      const object = {
        hours: vendorSettingsModel?.businessHours,
        days: vendorSettingsModel?.businessDays
      } as Types.Classes.CBusinessTime
      if (!Logics.DateTime.isBusinessTime(object)) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDER_SERVICE_NEW_ORDER_OUT_OF_SERVICE)
      }
      const userModels = contractModel.users
      if (!userModels || userModels.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_USER)
      }
      const userModel = userModels[0]
      let subtotal = 0
      const productModels = contractModel.products
      if (productModels?.length !== productsIDs.length) {
        this.logger.warn(
          `"productModels.length:", ${productModels?.length}, "productsID.length:", ${productsIDs.length}`
        )
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCT_NOT_EXIST)
      }

      const addressModels = userModel?.addresses
      if (!addressModels || addressModels.length !== 1) {
        throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_ADDRESS_NOT_VALID)
      }
      const addressModel = addressModels[0]

      let couponModel = null
      if (payload?.coupon) {
        const couponsResult = contractModel.coupons
        if (couponsResult?.length === 1) {
          couponModel = couponsResult?.[0]
        } else {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_COUPON_NOT_VALID)
        }
      }
      for (const product of payload?.products ?? []) {
        const filteredProduct = productModels.filter(element => element.id === product.id)
        if (filteredProduct.length !== 1) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT)
        }
        if ((filteredProduct?.[0].quantity ?? 0) < (product?.quantity ?? 0)) {
          throw new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_QUANTITY,
            filteredProduct[0].title
          )
        }
        if (
          (filteredProduct?.[0]?.price ?? 0) -
          Logics.Finances.calcDiscount(
            filteredProduct?.[0]?.price ?? 0,
            filteredProduct?.[0]?.discount ?? 0,
            filteredProduct?.[0]?.discountType ?? Types.Types.TDiscount.NO
          ) !==
          (product?.price ?? 0) -
          Logics.Finances.calcDiscount(
            product?.price ?? 0,
            product?.discount ?? 0,
            product?.discountType ?? Types.Types.TDiscount.NO
          )
        ) {
          throw new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PRICE,
            `${filteredProduct[0].title} => ${filteredProduct[0].price} !== ${couponModel
              ? Logics.Finances.calcDiscount(
                product.price ?? 0,
                product?.discount ?? 0,
                product?.discountType ?? Types.Types.TDiscount.NO
              )
              : product.price
            }`
          )
        }
        if (filteredProduct[0].title !== product.title) {
          throw new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_NAME,
            filteredProduct[0].title
          )
        }
      }

      //MARK: -- validate product options
      for (const product of payload.products) {
        const productModel = productModels.filter(productModel => productModel.id === product.id)[0]
        const productOptionIds = productOptionsIDs.filter(
          productOptions => productOptions.productId === productModel.id
        )
        if (
          productOptionIds.length !== 1 &&
          (productModel.productOptions?.length ?? 0) < (productOptionIds?.[0].optionsIds.size ?? 0)
        ) {
          this.logger.warn(
            `"productModel.productOptions.length:", ${productModel.productOptions?.length}, "productOptionIds?.[0].optionsId.size:", ${productOptionIds?.[0].optionsIds.size}`
          )
          throw new Utils.iKomidaError(this.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCT_OPTIONS_NOT_EXIST)
        }
      }

      //MARK: -- validate products, product options and calc subtotal
      for (const product of payload.products) {
        const filtredProductModels = productModels.filter(productModel => productModel.id === product.id)
        if (filtredProductModels?.length !== 1) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT_1)
        }
        const productModel = filtredProductModels[0]

        for (const option of product.options ?? []) {
          const filteredProductOptionModel = productModel.productOptions?.filter(
            productOptionModel => option.id === productOptionModel.id
          )
          if (!filteredProductOptionModel || filteredProductOptionModel.length !== 1) {
            throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT_2)
          }
          const productOptionModel = filteredProductOptionModel[0]
          if (
            (productOptionModel?.price ?? 0) !== option.price ||
            option.units > (productOptionModel?.units ?? 0) * product.quantity
          ) {
            this.logger.warn(
              `"productOptionModel?.price !== option.price:", ${productOptionModel?.price} !== ${option.price
              }, "option.units > productOptionModel?.units:", ${option.units} > ${(productOptionModel?.units ?? 0) * product.quantity
              }`
            )
            throw new Utils.iKomidaError(this.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCT_OPTIONS_NOT_EXIST)
          }
          subtotal +=
            ((productOptionModel.price ?? 0) -
              Logics.Finances.calcDiscount(
                productOptionModel.price ?? 0,
                productModel?.discount ?? 0,
                productModel?.discountType ?? Types.Types.TDiscount.NO
              )) *
            Number(option?.units)
        }

        subtotal +=
          ((productModel?.price ?? 0) -
            Logics.Finances.calcDiscount(
              productModel.price ?? 0,
              productModel?.discount ?? 0,
              productModel?.discountType ?? Types.Types.TDiscount.NO
            )) *
          Number(product?.quantity)
      }
      const discount = Logics.Finances.calcDiscount(subtotal, couponModel?.value ?? 0, couponModel?.valueType)
      if (!payload?.payment || !payload?.payment.id) {
        throw new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PAYMENT_METHOD_NOT_DEFINED
        )
      }

      const userCreditCardModels = userModel?.userCreditCards
      let userCreditCardModel = null
      if (
        !Utils.System.isDemo(contractModel?.ikomidaID, userModel?.areaCode, userModel?.phone) &&
        userCreditCardModels?.length === 1 &&
        Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE === userModel?.paymentMethodType
      ) {
        userCreditCardModel = userCreditCardModels?.[0]
      }

      let delivery: number | undefined = 0
      if (!vendorSettingsModel?.deliveryFree) {
        const calcDelivery = ((addressModel?.distance ?? 1) / 1000) * (vendorSettingsModel?.delivery ?? 0)
        delivery =
          calcDelivery < (vendorSettingsModel?.deliveryMin ?? 0) ? vendorSettingsModel?.deliveryMin : calcDelivery
        if (delivery !== payload?.delivery) {
          throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_DELIVERY_NOT_VALID)
        }
      }

      const orderId = uuidv4()
      const orderProducts = await Promise.all(
        payload.products.map(async product => {
          const filteredProductModels = productModels?.filter(productModel => product.id === productModel.id)
          if (filteredProductModels?.length !== 1) {
            throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT_2)
          }
          const productModel = filteredProductModels[0]
          await productModel.decrement(
            {
              quantity: product.quantity
            },
            {
              logging: console.log,
              transaction
            }
          )
          const orderProductOptions = await Promise.all(
            product.options?.map(async option => {
              const filteredProductOptions = productModel.productOptions?.filter(
                productOption => option.id === productOption.id
              )
              if (!filteredProductOptions || filteredProductOptions.length !== 1) {
                throw new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT_2)
              }
              const productOption = filteredProductOptions[0]
              return {
                name: productOption.name,
                price: productOption.price,
                units: option.units,
                orderId,
                productOptionId: productOption.id,
                contractId: contractModel.id
              }
            }) ?? []
          )
          return {
            title: productModel.title,
            discountType: productModel.discountType,
            price: productModel.price,
            discount: productModel.discount,
            quantity: product.quantity,
            orderId,
            userId: userModel.id,
            contractId: contractModel.id,
            productId: productModel.id,
            orderProductOptions
          }
        })
      )
      const orderPayload = {
        id: orderId,
        status: Types.Types.TOrderStatus.WAITING_PAYMENT,
        subtotal,
        discount,
        locationLatitude: payload?.location?.latitude,
        locationLongitude: payload?.location?.longitude,
        preparationMin: vendorSettingsModel?.preparationMin,
        preparationMax: vendorSettingsModel?.preparationMax,
        customID: (contractModel?.lastOrderCustomID ?? 0) + 1,
        paymentMethodType: userModel?.paymentMethodType,
        addressId: addressModel.id,
        couponId: couponModel?.id,
        contractId: contractModel.id,
        userCreditCardId: userCreditCardModel?.id,
        delivery,
        orderProducts
      }
      const orderModel: DBModels.OrderModel = await userModel.$create('order', orderPayload, {
        transaction,
        logging: console.log,
        include: [
          DBModels.AddressModel,
          DBModels.CouponModel,
          DBModels.ContractModel,
          DBModels.UserCreditCardModel,
          {
            model: DBModels.OrderProductModel,
            include: [
              {
                model: DBModels.OrderProductOptionModel,
                include: [DBModels.ContractModel, DBModels.ProductOptionModel]
              },
              DBModels.UserModel,
              DBModels.ContractModel,
              DBModels.ProductModel
            ]
          }
        ]
      })
      contractModel.lastOrderCustomID = orderModel.customID ?? 0
      await contractModel.save({
        logging: console.log,
        transaction
      })
      if (couponModel) {
        await couponModel.decrement(
          {
            quantity: 1
          },
          {
            logging: console.log,
            transaction
          }
        )
      }

      // const paymentTransaction = await Domain.SqlDB.sequelize.transaction({
      //   logging: console.log,
      //   autocommit: false,
      //   isolationLevel: Domain.SqlDB.Transaction.ISOLATION_LEVELS.READ_UNCOMMITTED
      // })
      try {
        if (userCreditCardModel?.id && orderModel.id) {
          const vendorSettingsModel = contractModel.vendorSettings
          if (!vendorSettingsModel) {
            throw new Utils.iKomidaError(
              Utils.iKomidaError.IKOMIDA_PAYMENTS_SERVICE_PROCESS_PAYMENT_INVALID_VENDOR_SETTINGS
            )
          }
          const vendorPaymentGatewayModel = vendorSettingsModel.vendorPaymentGateway
          const pagseguroHelper = new Helpers.PagseguroHelper(this.logger)

          const paymentGateway = await pagseguroHelper.configure(vendorPaymentGatewayModel)
          if (!paymentGateway) {
            throw new Utils.iKomidaError(
              Utils.iKomidaError.IKOMIDA_PAYMENTS_SERVICE_PROCESS_PAYMENT_INVALID_VENDOR_PAYMENT_SETTINGS
            )
          }
          if (!userCreditCardModel.type) {
            throw new Utils.iKomidaError(
              Utils.iKomidaError.IKOMIDA_PAYMENTS_SERVICE_PROCESS_PAYMENT_CREATE_CHARGE_ERROR
            )
          }
          const amount = Number(subtotal) + Number(delivery) - Number(discount)
          const chargeObject: Types.Classes.Pagseguro.CPagSeguroCreateCharge =
            Types.Classes.Pagseguro.CPagSeguroCreateCharge.init(
              orderId,
              amount,
              userCreditCardModel.type.pagseguro,
              slugging(vendorSettingsModel?.contractName),
              undefined,
              contractModel.id,
              undefined,
              userCreditCardModel.token,
              `iKomida/${contractModel?.contractName}`
            )
          const chargeResult = await paymentGateway.createCharge(chargeObject)
          if (!chargeResult) {
            throw new Utils.iKomidaError(
              Utils.iKomidaError.IKOMIDA_PAYMENTS_SERVICE_PROCESS_PAYMENT_CREATE_CHARGE_ERROR
            )
          }
          const userPaymentModel: DBModels.UserPaymentModel = await userModel.$create(
            'userPayment',
            {
              status: chargeResult.status,
              gateway: paymentGateway.constructor.name,
              brand: userCreditCardModel.brand,
              firstDigits: userCreditCardModel.firstDigits,
              lastDigits: userCreditCardModel.lastDigits,
              gatewayPaymentID: chargeResult.id,
              orderID: chargeResult.reference,
              amount: chargeResult.amount,
              contractId: contractModel.id,
              userCreditCardId: userCreditCardModel.id,
              orderId
            },
            {
              logging: console.log,
              transaction
            }
          )
          if (!userPaymentModel) {
            throw new Utils.iKomidaError(
              Utils.iKomidaError.IKOMIDA_PAYMENTS_SERVICE_PROCESS_PAYMENT_CREATE_CHARGE_ERROR
            )
          }
          if (chargeResult.status === Types.Types.TPagSeguroPaymentStatus.PAID) {
            orderModel.status = Types.Types.TOrderStatus.OPEN
          } else if (
            chargeResult.status &&
            ![Types.Types.TPagSeguroPaymentStatus.INANALYSE, Types.Types.TPagSeguroPaymentStatus.AUTHORIZED].includes(
              chargeResult.status
            )
          ) {
            orderModel.status = Types.Types.TOrderStatus.CANCELED
            orderModel.finishedAt = new Date()
          }
        } else {
          orderModel.status = Types.Types.TOrderStatus.OPEN
        }
        console.log('orderpayment:')
        await orderModel.save({
          logging: console.log,
          transaction
        })
        // await paymentTransaction.commit()
      } catch (exception: any) {
        // await paymentTransaction.rollback()
        let error: Utils.iKomidaError
        if (exception instanceof Utils.iKomidaError) {
          error = exception
        } else {
          error = new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PAYMENT_EXCEPTION,
            exception
          )
        }
        throw error
      }

      console.log('order befor commited')
      await transaction.commit()
      console.log('order commited')
      console.log('0')

      const orderProductModels: DBModels.OrderProductModel[] = orderModel.orderProducts ?? []
      console.log('1')
      const products =
        orderProductModels.map(orderProduct => {
          console.log('2')
          const orderProductOptions = orderProduct.orderProductOptions?.map(orderProductOption => {
            console.log('3')
            return Types.Classes.CProductOption.init(
              orderProductOption.name ?? '',
              false,
              orderProductOption.price ?? 0,
              orderProductOption.units ?? 0,
              0
            )
          })
          console.log('4')
          return Types.Classes.CProduct.init(
            orderProduct.title ?? '-',
            orderProduct.price ?? 0,
            orderProduct.discount ?? 0,
            orderProduct.discountType ?? Types.Types.TDiscount.NO,
            orderProduct.quantity ?? 0,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            orderProductOptions
          )
        }) ?? []
      console.log('5')
      const address = Types.Classes.CAddress.init(
        addressModel.postalCode ?? '-',
        addressModel.street ?? '-',
        addressModel.neighborhood ?? '-',
        addressModel.city ?? '-',
        addressModel.stat ?? '-',
        addressModel.number,
        addressModel.complement,
        addressModel.kind,
        addressModel.reference,
        addressModel.distance,
        addressModel.duration
      )
      console.log('6')
      let payment: Types.Classes.CPaymentMethod | undefined
      console.log('7')
      if (userCreditCardModel) {
        console.log('8')
        payment = Types.Classes.CPaymentMethod.init(
          userCreditCardModel.type ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
          userCreditCardModel.brand ?? 'Unknown',
          userCreditCardModel.lastDigits ?? '',
          userCreditCardModel.firstDigits ?? ''
        )
        console.log('9')
      }
      console.log('10')
      const preparation = Types.Classes.COrderPreparation.init(
        (vendorSettingsModel.preparationMin ?? 0) * 60,
        (vendorSettingsModel.preparationMax ?? 0) * 60
      )
      console.log('11')

      const coupon = Types.Classes.CCoupon.init(
        couponModel?.name ?? '-',
        couponModel?.value ?? 0,
        couponModel?.valueType ?? Types.Types.TDiscount.NO
      )
      console.log('12')

      const order = Types.Classes.COrder.init(
        subtotal,
        discount,
        delivery,
        products,
        address,
        userModel.paymentMethodType ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
        preparation,
        coupon,
        orderModel.createdAt,
        orderModel.customID,
        orderModel.status,
        orderModel.finishedAt,
        payment,
        undefined,
        orderId,
        orderModel.createdAt.getTime()
      )
      console.log('13')
      console.log('order:', JSON.stringify(order.toJSON()))

      // try {
      //   const pNModels = contractModel?.pNs
      //   if ((pNModels?.length ?? 0) === 1) {
      //     const notification = Types.Classes.CNotification.fromObject(Utils.Notification.NEW_ORDER)
      //     const message = new Types.Classes.CNotificationPayload()
      //     message.notification = Utils.Notification.NEW_ORDER
      //     message.data = new Types.Classes.CNotificationData()
      //     message.data.method = notification.method
      //     message.data.uri = notification.uri
      //     message.data.logon = notification.logon
      //     message.data.payload = orderId
      //     const payload = new Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject>()
      //     payload.method = 'send'
      //     const payloadObject = new Types.Classes.CAMQPPayloadObject()
      //     payloadObject.message = message
      //     payloadObject.contractId = contractModel?.id
      //     payload.object = payloadObject

      //     const amqp = new Domain.RabbitMQ(this.logger)
      //     await amqp?.publish(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, payload)
      //     await amqp?.close()
      //   } else {
      //     this.logger.warn(`[NEW_ORDERS] - Dispositivo ou usuário não cadastrado para receber notificações push.`)
      //   }
      // } catch (exception: any) {
      //   const error = new Utils.iKomidaError(
      //     Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
      //     exception
      //   )
      //   error.log(this.logger)
      // }
      return new Utils.Return(true, order)
    } catch (exception: any) {
      await transaction?.rollback()
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

  async changeOrderStatus(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.COrder = Types.Classes.COrder.fromObject(input)
      if (
        !payload?.status ||
        !payload?.id ||
        ![Types.Types.TOrderStatus.CANCELED, Types.Types.TOrderStatus.DELIVERED].includes(payload?.status)
      ) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WRONG_STATUS)
        return error.logAndReturn(this.logger)
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID
        },
        include: [
          {
            model: DBModels.PNModel,
            where: {
              role: BackendTypes.Roles.VENDOR
            },
            required: false
          },
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT]
              }
            },
            include: [
              {
                model: DBModels.OrderModel,
                required: true,
                where: {
                  id: payload?.id
                },
                include: [DBModels.UserPaymentModel]
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
      const orders = userModels?.[0]?.orders
      const order = orders?.[0]
      if ((orders?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_ORDER_NOT_FOUND
        )
        return error.logAndReturn(this.logger)
      }
      if (
        (order?.status &&
          ![Types.Types.TOrderStatus.WAITING_PAYMENT, Types.Types.TOrderStatus.OPEN].includes(order?.status) &&
          Types.Types.TOrderStatus.CANCELED === payload?.status) ||
        (order?.status &&
          ![
            Types.Types.TOrderStatus.OPEN,
            Types.Types.TOrderStatus.ACCEPTED,
            Types.Types.TOrderStatus.WAITING_DELIVERY,
            Types.Types.TOrderStatus.IN_DELIVERY
          ].includes(order?.status) &&
          Types.Types.TOrderStatus.DELIVERED === payload?.status)
      ) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WRONG_STATUS)
        return error.logAndReturn(this.logger)
      }
      if (
        order?.userPayment?.status &&
        ![
          Types.Types.TPagSeguroPaymentStatus.PAID,
          Types.Types.TPagSeguroPaymentStatus.INANALYSE,
          Types.Types.TPagSeguroPaymentStatus.AUTHORIZED
        ].includes(order?.userPayment?.status) &&
        order?.paymentMethodType === Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WAITING_PAYMENT
        )
        return error.logAndReturn(this.logger)
      }
      if (
        order?.status &&
        Types.Types.TOrderStatus.CANCELED === payload?.status &&
        order?.userPayment?.status !== Types.Types.TPagSeguroPaymentStatus.CANCELED &&
        [Types.Types.TOrderStatus.WAITING_PAYMENT, Types.Types.TOrderStatus.OPEN].includes(order?.status) &&
        order?.paymentMethodType === Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        try {
          const paymentPayload = new Types.Classes.CAMQPPayload<string>()
          paymentPayload.method = 'cancelPayment'
          paymentPayload.object = order?.userPayment?.id ?? '-'
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
      if (order) {
        order.status = payload.status
        order.finishedAt = new Date()
        await order.save()
      }
      try {
        const pNModel = contractModel?.pNs?.[0]
        if (pNModel) {
          const notification = new Utils.Notification(Utils.Notification.ORDER_UPDATED)
          const message = new Types.Classes.CNotificationPayload()
          message.notification = notification
          message.data = new Types.Classes.CNotificationData()
          message.data.method = notification.method
          message.data.uri = notification.uri
          message.data.logon = notification.logon
          message.data.payload = order?.id
          const payload = new Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject>()
          payload.method = 'send'
          const payloadObject = new Types.Classes.CAMQPPayloadObject()
          payloadObject.message = message
          payloadObject.userId = order?.user?.id
          payloadObject.contractId = contractModel?.id
          payload.object = payloadObject
          const amqp = new Domain.RabbitMQ(this.logger)
          await amqp?.publish(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, payload)
          await amqp?.close()
        }
        return new Utils.Return(
          true,
          Types.Classes.COrder.fromObject({ id: order?.id, status: order?.status, finishedAt: order?.finishedAt })
        )
      } catch (exception: any) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
          exception?.message
        )
        error.log(this.logger)
      }
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
    if (!role || ![BackendTypes.Roles.CLIENT].includes(role)) {
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
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT]
            }
          },
          include: [
            {
              model: DBModels.OrderModel,
              required: false
            }
          ]
        }
      ]
    })
    if (!contractModel || !contractModel?.users) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_COUNT_INVALID_CONTRACT)
      return error.logAndReturn(this.logger)
    }
    return new Utils.Return(true, contractModel?.orders?.length ?? 0)
  }
}
