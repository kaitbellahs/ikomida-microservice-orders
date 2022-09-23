import { Domain, Utils, BackendTypes, Logics, Types, DBModels } from '@ikomida/shared-backend';
import { IiKomidaErrorModel } from '@ikomida/shared-backend/lib/Utils/iKomidaError';
import axios from 'axios';
export default class Orders {
  logger;
  limit = 10;

  constructor(logger: Utils.Logger) {
    this.logger = logger;
  }

  async getOrders(identity: Types.Classes.CUser, timestamp = 0) {
    const where =
      timestamp && timestamp != 0 && Number(Logics.Finances.toNumber(timestamp)) == timestamp
        ? {
          createdAt: {
            [Domain.SqlDB.Op.lt]: new Date(Number(Logics.Finances.toNumber(timestamp))),
          },
        }
        : {};
    const contractModel = await DBModels.ContractModel.findOne({
      where: {
        ikomidaID: identity.ikomidaID,
      },
      include: [
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT],
            },
          },
          include: [
            {
              model: DBModels.OrderModel,
              required: false,
              include: [
                {
                  model: DBModels.OrderProductModel,
                  required: false,
                },
                {
                  model: DBModels.UserPaymentModel,
                  required: false,
                  include: [
                    {
                      model: DBModels.UserCreditCardModel,
                      required: false,
                    },
                  ],
                },
                {
                  model: DBModels.AddressModel,
                  required: false,
                },
                {
                  model: DBModels.CouponModel,
                  required: false,
                },
              ],
              order: [['createdAt', 'DESC']],
              limit: this.limit,
              where,
            },
          ],
        },
      ],
    });
    if (!contractModel) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_INVALID_CONTRACT);
      return error.logAndReturn(this.logger);
    }
    const userModels = contractModel?.users;
    if (!userModels || userModels.length !== 1) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_INVALID_USER);
      return error.logAndReturn(this.logger);
    }
    const orderModels = userModels?.[0].orders;
    const orders = orderModels?.map((orderModel) => {
      const userCreditCard = orderModel.userPayment?.userCreditCard;

      const products =
        orderModel.orderProducts?.map((orderProduct) => {
          return Types.Classes.CProduct.init(
            orderProduct?.title ?? '-',
            orderProduct?.price ?? 0,
            orderProduct?.discount ?? 0,
            orderProduct?.discountType ?? Types.Types.TDiscount.NO,
            orderProduct?.quantity ?? 0,
          );
        }) ?? [];
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
        orderModel.address?.duration,
      );

      const payment = Types.Classes.CPaymentMethod.init(
        orderModel.paymentMethodType ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
        userCreditCard?.brand ?? 'Unknown',
        userCreditCard?.lastDigits ?? 0,
      );

      const preparation = Types.Classes.COrderPreparation.init(
        (orderModel.preparationMin ?? 0) * 60,
        (orderModel.preparationMax ?? 0) * 60,
      );

      const coupon = Types.Classes.CCoupon.init(
        orderModel.coupon?.name ?? '-',
        orderModel.coupon?.value ?? 0,
        orderModel.coupon?.valueType ?? Types.Types.TDiscount.NO,
      );

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
        orderModel.createdAt.getTime(),
      );
      return order;
    });
    return new Utils.Return(
      true,
      orders
        ?.filter((order) => order !== null)
        ?.sort((item1, item2) => (item2?.timestamp ?? 0) - (item1?.timestamp ?? 0)),
    );
  }

  async newOrder(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.COrder = Types.Classes.COrder.fromObject(input)
      const productsID = [...new Set(payload?.products?.map((item: Types.Classes.CProduct) => item.id))];
      const includeCoupon = payload?.coupon?.id
        ? [
          {
            model: DBModels.CouponModel,
            required: false,
            where: {
              id: payload?.coupon?.id,
              quantity: {
                [Domain.SqlDB.Op.gt]: 0,
              },
              validity: {
                [Domain.SqlDB.Op.gt]: new Date(),
              },
            },
            limit: 2,
          },
        ]
        : [];

      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity?.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT],
              },
            },
            include: [
              {
                model: DBModels.UserCreditCardModel,
                where: {
                  id: payload.payment?.id,
                },
                required: false,
              },
              {
                model: DBModels.AddressModel,
                where: {
                  id: payload.address?.id,
                },
                required: false,
              },
            ],
          },
          {
            model: DBModels.PlanModel,
            required: true,
          },
          {
            model: DBModels.VendorSettingsModel,
            required: false,
          },
          {
            model: DBModels.ProductModel,
            where: {
              id: {
                [Domain.SqlDB.Op.in]: productsID,
              },
            },
            required: false,
          },
          {
            model: DBModels.ContractPaymentSignatureModel,
            required: false,
          },
          {
            model: DBModels.PNModel,
            where: {
              role: BackendTypes.Roles.VENDOR,
            },
            required: false,
          },
          {
            model: DBModels.OrderModel,
            where: {
              createdAt: {
                [Domain.SqlDB.Op.gt]: Domain.SqlDB.Column('contractPaymentSignature.lastDueDate'),
              },
              status: {
                [Domain.SqlDB.Op.notIn]: [Types.Types.TOrderStatus.CANCELED.id],
              },
            },
            required: false,
          },
          ...includeCoupon,
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }

      const ordersLimit = contractModel?.plan?.orders ?? -1;
      if (ordersLimit !== 0 && (contractModel?.orders?.length ?? 0) >= ordersLimit) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_LIMIT_EXCEEDED, ordersLimit);
        return error.logAndReturn(this.logger);
      }

      const ordersTotal = contractModel?.orders?.map(
        (order) => Number(order?.subtotal) + Number(order?.delivery) - Number(order?.discount),
      );
      const billing = (ordersTotal?.length ?? 0) > 0 ? ordersTotal?.reduce((a, b) => a + b) : 0;
      const billingLimit = contractModel?.plan?.billing ?? 0 ?? -1;
      if (billingLimit !== 0 && (billing ?? 0) >= billingLimit) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_BILLING_LIMIT_EXCEEDED,
          billingLimit,
        );
        return error.logAndReturn(this.logger);
      }
      const vendorSettingsModel = contractModel?.vendorSettings;
      if (!vendorSettingsModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_EMPTY);
        return error.logAndReturn(this.logger);
      }
      const object = {
        hours: vendorSettingsModel?.businessHours,
        days: vendorSettingsModel?.businessDays,
      } as Types.Classes.CBusinessTime;
      if (!Logics.DateTime.isBusinessTime(object)) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDER_SERVICE_NEW_ORDER_OUT_OF_SERVICE);
        return error.logAndReturn(this.logger);
      }
      const userModels = contractModel.users;
      if (!userModels || userModels.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_USER);
        return error.logAndReturn(this.logger);
      }
      const userModel = userModels[0];
      let subtotal = 0;
      const productModels = contractModel.products;
      if (productModels?.length !== productsID.length) {
        this.logger.warn(
          `"productModels.length:", ${productModels?.length}, "productsID.length:", ${productsID?.length}`,
        );
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCT_NOT_EXIST);
        return error.logAndReturn(this.logger);
      }
      let couponModel = null;
      if (payload?.coupon) {
        const couponsResult = contractModel.coupons;
        if ((couponsResult?.length ?? 0) === 1) {
          couponModel = couponsResult?.[0];
        } else {
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_COUPON_NOT_VALID);
          return error.logAndReturn(this.logger);
        }
      }
      for (const product of payload?.products ?? []) {
        const filteredProduct = productModels.filter((element) => element.id === product.id);
        if (filteredProduct.length !== 1) {
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT);
          return error.logAndReturn(this.logger);
        }
        if ((filteredProduct?.[0].quantity ?? 0) < (product?.quantity ?? 0)) {
          const error = new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_QUANTITY,
            filteredProduct[0].title,
          );
          return error.logAndReturn(this.logger);
        }
        if (
          (filteredProduct?.[0]?.price ?? 0) -
          Logics.Finances.calcDiscount(
            filteredProduct?.[0]?.price ?? 0,
            filteredProduct?.[0]?.discount ?? 0,
            filteredProduct?.[0]?.discountType ?? Types.Types.TDiscount.NO,
          ) !==
          (product?.price ?? 0) -
          Logics.Finances.calcDiscount(
            product?.price ?? 0,
            product?.discount ?? 0,
            product?.discountType ?? Types.Types.TDiscount.NO,
          )
        ) {
          const error = new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PRICE,
            `${filteredProduct[0].title} => ${filteredProduct[0].price} !== ${couponModel
              ? Logics.Finances.calcDiscount(
                product.price ?? 0,
                product?.discount ?? 0,
                product?.discountType ?? Types.Types.TDiscount.NO,
              )
              : product.price
            }`,
          );
          return error.logAndReturn(this.logger);
        }
        if (filteredProduct[0].title !== product.title) {
          const error = new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_NAME,
            filteredProduct[0].title,
          );
          return error.logAndReturn(this.logger);
        }
      }
      for (const productModel of productModels) {
        const filteredProduct = payload?.products?.filter(
          (element: Types.Classes.CProduct) => element.id === productModel.id,
        );
        if (filteredProduct?.length !== 1) {
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT_1);
          return error.logAndReturn(this.logger);
        }
        const product = filteredProduct[0];
        subtotal +=
          ((productModel?.price ?? 0) -
            Logics.Finances.calcDiscount(
              productModel.price ?? 0,
              productModel?.discount ?? 0,
              productModel?.discountType ?? Types.Types.TDiscount.NO,
            )) *
          Number(product?.quantity);
      }
      const discount = Logics.Finances.calcDiscount(subtotal, couponModel?.value ?? 0, couponModel?.valueType);
      if (!payload?.payment || !payload?.payment.id) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PAYMENT_METHOD_NOT_DEFINED);
        return error.logAndReturn(this.logger);
      }

      const orderModel: DBModels.OrderModel = await userModel.$create('order', {
        status: Types.Types.TOrderStatus.WAITING_PAYMENT,
        subtotal,
        discount,
        locationLatitude: payload?.location?.latitude,
        locationLongitude: payload?.location?.longitude,
        preparationMin: vendorSettingsModel?.preparationMin,
        preparationMax: vendorSettingsModel?.preparationMax,
        customID: (contractModel?.lastOrderCustomID ?? 0) + 1,
        paymentMethodType: userModel?.paymentMethodType,
      });
      contractModel.lastOrderCustomID = orderModel.customID ?? 0;
      await contractModel.save();
      // await orderModel.$set('contract', contractModel)
      await contractModel.$add('order', orderModel);
      if (couponModel) {
        await couponModel.decrement({
          quantity: 1,
        });
        await orderModel.$set('coupon', couponModel)
      }
      const userCreditCardModels = userModel?.userCreditCards;

      let userCreditCardModel = null;

      if (
        !Utils.System.isDemo(contractModel?.ikomidaID, userModel?.areaCode, userModel?.phone) &&
        (userCreditCardModels?.length ?? 0) === 1 &&
        Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE === userModel?.paymentMethodType
      ) {
        userCreditCardModel = userCreditCardModels?.[0];
        if (userCreditCardModel) {
          await orderModel.$set('userCreditCard', userCreditCardModel)
        }
      }

      const addressModels = userModel?.addresses;
      if (!addressModels || addressModels.length !== 1) {
        if (couponModel) {
          await couponModel.increment({
            quantity: 1,
          });
        }
        await orderModel.destroy();
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_ADDRESS_NOT_VALID);
        return error.logAndReturn(this.logger);
      }
      const addressModel = addressModels[0];
      let delivery: number | undefined = 0;
      if (!vendorSettingsModel?.deliveryFree) {
        const calcDelivery = ((addressModel?.distance ?? 1) / 1000) * (vendorSettingsModel?.delivery ?? 0);
        delivery =
          calcDelivery < (vendorSettingsModel?.deliveryMin ?? 0) ? vendorSettingsModel?.deliveryMin : calcDelivery;
        if (delivery !== payload?.delivery) {
          if (couponModel) {
            await couponModel.increment({
              quantity: 1,
            });
          }
          await orderModel.destroy();
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_DELIVERY_NOT_VALID);
          return error.logAndReturn(this.logger);
        }
      }
      orderModel.delivery = delivery;
      await orderModel.save();
      await orderModel.$set('address', addressModel)
      for (const productModel of productModels) {
        const filteredProduct = payload?.products?.filter(
          (element: Types.Classes.CProduct) => element.id === productModel.id,
        );
        if (filteredProduct?.length !== 1) {
          return await this.pullBack(orderModel, Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_CONFLICT_2, couponModel)
        }
        const product = filteredProduct[0];
        await productModel.decrement({
          quantity: product.quantity,
        });
        const orderProductModel: DBModels.OrderProductModel = await orderModel.$create('orderProduct', {
          title: productModel.title,
          price: productModel.price,
          discount: productModel.discount,
          discountType: productModel.discountType,
          quantity: product.quantity,
        });
        // await productModel.$add('orderProduct', orderProductModel)
        await orderProductModel.$set('product', productModel)
        await orderProductModel.$set('contract', contractModel)
        await orderProductModel.$set('user', userModel)
      }
      try {
        if (userCreditCardModel?.id && orderModel.id) {
          const processPaymentRequest = Types.Classes.CProcessPayment.init(userCreditCardModel?.id, Number(subtotal) + Number(delivery) - Number(discount), orderModel.id);
          if ((String(processPaymentRequest?.amount)?.length ?? 0) > 9) {
            return await this.pullBack(orderModel, Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_AMOUNT, couponModel)
          }
          const response = await axios.post(
            `${Domain.MicroService.payments}/processPayment`,
            processPaymentRequest.toJSON(),
            {
              headers: {
                identity: JSON.stringify(identity.toJSON()),
                'X-Requested-With': 'iKomida-PS-V0.0.1',
              },
            },
          );
          const returnResponse = new Utils.Return<Types.Classes.CProcessPaymentResponse>(response.data.success, Types.Classes.CProcessPaymentResponse.fromObject(response.data.data), response.status)
          const processPaymentResponse = returnResponse.data
          if (
            response.status < 200 ||
            response.status >= 300 ||
            !returnResponse?.success ||
            !returnResponse?.data
          ) {
            return await this.pullBack(orderModel, Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PAYMENT_RESPONSE_INVILID, couponModel)
          }
          const userPaymentModels = await userModel.$get('userPayments', {
            where: {
              id: processPaymentResponse?.id,
            },
          });
          if ((userPaymentModels?.length ?? 0) !== 1) {
            return await this.pullBack(orderModel, Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PAYMENT_RESPONSE_INVILID, couponModel)
          }
          const userPaymentModel = userPaymentModels?.[0];
          await orderModel.$set('userPayment', userPaymentModel)
          if (userPaymentModel?.status === Types.Types.TPagSeguroPaymentStatus.PAID) {
            orderModel.status = Types.Types.TOrderStatus.OPEN;
          } else if (
            userPaymentModel?.status &&
            ![Types.Types.TPagSeguroPaymentStatus.INANALYSE, Types.Types.TPagSeguroPaymentStatus.AUTHORIZED].includes(
              userPaymentModel?.status,
            )
          ) {
            orderModel.status = Types.Types.TOrderStatus.CANCELED;
            orderModel.finishedAt = new Date();
          }
        } else {
          orderModel.status = Types.Types.TOrderStatus.OPEN;
        }
        await orderModel.save();
      } catch (exception: any) {
        return await this.pullBack(orderModel, Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_PAYMENT_EXCEPTION, couponModel, exception)
      }

      const orderProductModels: DBModels.OrderProductModel[] = await orderModel.$get('orderProducts')
      const products =
        orderProductModels?.map((orderProduct) => {
          return Types.Classes.CProduct.init(
            orderProduct?.title ?? '-',
            orderProduct?.price ?? 0,
            orderProduct?.discount ?? 0,
            orderProduct?.discountType ?? Types.Types.TDiscount.NO,
            orderProduct?.quantity ?? 0,
          );
        }) ?? [];
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
        addressModel.duration,
      );
      let payment: Types.Classes.CPaymentMethod | undefined
      if (userCreditCardModel) {
        payment = Types.Classes.CPaymentMethod.init(
          userCreditCardModel?.type ?? Types.Types.TPaymentMethod.CASH_ON_DELIVERY,
          userCreditCardModel?.brand ?? 'Unknown',
          userCreditCardModel?.lastDigits ?? 0,
        );

      }
      const preparation = Types.Classes.COrderPreparation.init(
        (vendorSettingsModel.preparationMin ?? 0) * 60,
        (vendorSettingsModel.preparationMax ?? 0) * 60,
      );

      const coupon = Types.Classes.CCoupon.init(
        couponModel?.name ?? '-',
        couponModel?.value ?? 0,
        couponModel?.valueType ?? Types.Types.TDiscount.NO,
      );

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
        orderModel.id,
        orderModel.createdAt.getTime(),
      );

      try {
        const pNModels = contractModel?.pNs;
        if ((pNModels?.length ?? 0) === 1) {
          const notification = new Utils.Notification(Utils.Notification.NEW_ORDER);
          const message = new Types.Classes.CNotificationPayload();
          message.notification = notification;
          message.data = new Types.Classes.CNotificationData();
          message.data.method = notification.method;
          message.data.uri = notification.uri;
          message.data.logon = notification.logon;
          message.data.payload = order.id;
          const payload = new Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject>();
          payload.method = 'send';
          const payloadObject = new Types.Classes.CAMQPPayloadObject();
          payloadObject.message = message;
          payloadObject.contractId = contractModel?.id;
          payload.object = payloadObject;

          const amqp = new Domain.RabbitMQ(this.logger);
          await amqp?.publish(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, payload);
          await amqp?.close();
        } else {
          this.logger.warn(`[NEW_ORDERS] - Dispositivo ou usuário não cadastrado para receber notificações push.`);
        }
      } catch (exception: any) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION, exception);
        error.log(this.logger);
      }
      return new Utils.Return(true, order);
    } catch (exception: any) {
      const error = new Utils.iKomidaError(
        Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
        exception?.message,
      );
      return error.logAndReturn(this.logger);
    }
  }

  private async pullBack(orderModel: DBModels.OrderModel, iKomidaError: IiKomidaErrorModel, couponModel?: DBModels.CouponModel | null, exception?: any) {
    if (couponModel) {
      await couponModel.increment({
        quantity: 1,
      });
      const orderProductModels: DBModels.OrderProductModel[] = await orderModel.$get('orderProducts', {
        include: {
          model: DBModels.ProductModel,
          required: false,
        },
      });
      for (const orderProductModel of orderProductModels) {
        await orderProductModel?.product?.decrement({
          quantity: orderProductModel?.quantity,
        });
      }
      await DBModels.OrderProductModel.destroy({
        where: {
          id: orderModel.id,
        },
      });
      await orderModel.destroy();
    }
    const error = new Utils.iKomidaError(iKomidaError, exception);
    return error.logAndReturn(this.logger);
  }

  async changeOrderStatus(identity: Types.Classes.CUser, input: any) {
    try {
      const payload: Types.Classes.COrder = Types.Classes.COrder.fromObject(input)
      if (!payload?.status || !payload?.id ||
        ![Types.Types.TOrderStatus.CANCELED, Types.Types.TOrderStatus.DELIVERED].includes(payload?.status)
      ) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WRONG_STATUS);
        return error.logAndReturn(this.logger);
      }
      const contractModel = await DBModels.ContractModel.findOne({
        where: {
          ikomidaID: identity.ikomidaID,
        },
        include: [
          {
            model: DBModels.PNModel,
            where: {
              role: BackendTypes.Roles.VENDOR,
            },
            required: false,
          },
          {
            model: DBModels.UserModel,
            required: true,
            where: {
              id: identity.id,
              role: {
                [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT],
              },
            },
            include: [
              {
                model: DBModels.OrderModel,
                required: true,
                where: {
                  id: payload?.id,
                },
                include: [DBModels.UserPaymentModel],
              },
            ],
          },
        ],
      });
      if (!contractModel) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_CONTRACT);
        return error.logAndReturn(this.logger);
      }
      const userModels = contractModel.users;
      if (!userModels || userModels.length !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_INVALID_USER);
        return error.logAndReturn(this.logger);
      }
      const orders = userModels?.[0]?.orders;
      const order = orders?.[0];
      if ((orders?.length ?? 0) !== 1) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_ORDER_NOT_FOUND);
        return error.logAndReturn(this.logger);
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
            Types.Types.TOrderStatus.IN_DELIVERY,
          ].includes(order?.status) &&
          Types.Types.TOrderStatus.DELIVERED === payload?.status)
      ) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WRONG_STATUS);
        return error.logAndReturn(this.logger);
      }
      if (
        order?.userPayment?.status &&
        ![
          Types.Types.TPagSeguroPaymentStatus.PAID,
          Types.Types.TPagSeguroPaymentStatus.INANALYSE,
          Types.Types.TPagSeguroPaymentStatus.AUTHORIZED,
        ].includes(order?.userPayment?.status) &&
        order?.paymentMethodType === Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_WAITING_PAYMENT);
        return error.logAndReturn(this.logger);
      }
      if (
        order?.status &&
        Types.Types.TOrderStatus.CANCELED === payload?.status &&
        order?.userPayment?.status !== Types.Types.TPagSeguroPaymentStatus.CANCELED &&
        [Types.Types.TOrderStatus.WAITING_PAYMENT, Types.Types.TOrderStatus.OPEN].includes(order?.status) &&
        order?.paymentMethodType === Types.Types.TPaymentMethod.CREDIT_CARD_ONLINE
      ) {
        try {
          const paymentPayload = new Types.Classes.CAMQPPayload<string>();
          paymentPayload.method = 'cancelPayment';
          paymentPayload.object = order?.userPayment?.id ?? '-';
          const amqp = new Domain.RabbitMQ(this.logger);
          await amqp?.publish(Domain.RabbitMQ.PAYMENT_QUEUE, paymentPayload);
          await amqp?.close();
        } catch (exception: any) {
          new Utils.iKomidaError(
            Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_PAYMENT_EXCEPTION,
            exception?.message,
          ).log(this.logger);
          console.error(exception);
          const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_CHANGE_ORDER_STATUS_ERROR);
          return error.logAndReturn(this.logger);
        }
      }
      if (order) {
        order.status = payload.status;
        order.finishedAt = new Date();
        await order.save();
      }
      try {
        const pNModel = contractModel?.pNs?.[0];
        if (pNModel) {
          const notification = new Utils.Notification(Utils.Notification.ORDER_UPDATED);
          const message = new Types.Classes.CNotificationPayload();
          message.notification = notification;
          message.data = new Types.Classes.CNotificationData();
          message.data.method = notification.method;
          message.data.uri = notification.uri;
          message.data.logon = notification.logon;
          message.data.payload = order?.id;
          const payload = new Types.Classes.CAMQPPayload<Types.Classes.CAMQPPayloadObject>();
          payload.method = 'send';
          const payloadObject = new Types.Classes.CAMQPPayloadObject();
          payloadObject.message = message;
          payloadObject.userId = order?.user?.id;
          payloadObject.contractId = contractModel?.id;
          payload.object = payloadObject;
          const amqp = new Domain.RabbitMQ(this.logger);
          await amqp?.publish(Domain.RabbitMQ.PUSH_NOTIFICATION_QUEUE, payload);
          await amqp?.close();
        }
        return new Utils.Return(true, Types.Classes.COrder.fromObject({ id: order?.id, status: order?.status, finishedAt: order?.finishedAt }));
      } catch (exception: any) {
        const error = new Utils.iKomidaError(
          Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
          exception?.message,
        );
        error.log(this.logger);
      }
    } catch (exception: any) {
      const error = new Utils.iKomidaError(
        Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_NEW_ORDER_PRODUCTS_EXCEPTION,
        exception?.message,
      );
      return error.logAndReturn(this.logger);
    }
  }

  async getOrdersCount(identity: Types.Classes.CUser) {
    const role = BackendTypes.Roles.valueOf(identity.role);
    if (!role || ![BackendTypes.Roles.CLIENT].includes(role)) {
      return new Utils.Return(true, 0);
    }
    const contractModel = await DBModels.ContractModel.findOne({
      where: {
        ikomidaID: identity.ikomidaID,
      },
      include: [
        {
          model: DBModels.UserModel,
          required: true,
          where: {
            id: identity.id,
            role: {
              [Domain.SqlDB.Op.in]: [BackendTypes.Roles.CLIENT],
            },
          },
          include: [
            {
              model: DBModels.OrderModel,
              required: false,
            },
          ],
        },
      ],
    });
    if (!contractModel || !contractModel?.users) {
      const error = new Utils.iKomidaError(Utils.iKomidaError.IKOMIDA_ORDERS_SERVICE_GET_ORDERS_COUNT_INVALID_CONTRACT);
      return error.logAndReturn(this.logger);
    }
    return new Utils.Return(true, contractModel?.orders?.length ?? 0);
  }
}
