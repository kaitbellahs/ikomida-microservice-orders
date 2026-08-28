# ikomida-microservice-orders

The order lifecycle.

> Part of the **iKomida** platform. See **[ikomida-k8s-config](https://github.com/kaitbellahs/ikomida-k8s-config)** for the architecture overview of all 31 repositories.

---

## Role

Splits deliberately into a client-facing controller and a vendor-facing one, because the same order means different things on each side: the client tracks a purchase, the vendor works a queue. Emits push notifications as the order changes state.

Orders left unpaid or unattended are not the concern of this service — see [job-orders-check](https://github.com/kaitbellahs/ikomida-job-orders-check).

## Endpoints

As declared in the [gateway route table](https://github.com/kaitbellahs/ikomida-microservice-gateway/blob/dev/src/routes.ts) (6 routes reach this service):

| Method | Path | Roles |
|---|---|---|
| `PUT` | `/order` | VENDOR, STAFF, CLIENT |
| `POST` | `/order` | CLIENT |
| `GET` | `/ordersCount` | VENDOR, STAFF |
| `GET` | `/orders/:timestamp` | CLIENT, VENDOR, STAFF |
| `GET` | `/order/:id` | CLIENT, VENDOR, STAFF |
| `GET` | `/orders/:timestamp/history` | CLIENT, VENDOR, STAFF |

## Stack

TypeScript (ESM) · Express · Sequelize · rollup · Docker · Kubernetes

Depends on [`@ikomida/shared-types`](https://github.com/kaitbellahs/ikomida-shared-types), [`@ikomida/shared-backend`](https://github.com/kaitbellahs/ikomida-shared-backend) and [`@ikomida/shared-logics`](https://github.com/kaitbellahs/ikomida-shared-logics).

## Build

```bash
yarn install
yarn build      # rollup bundle
yarn service    # run locally
```

## Status

Built in 2022. The platform is no longer deployed; this repository is published as a record of the work. **The commit history predates generative AI coding assistants.**

## License

Licensed under the [Apache License 2.0](LICENSE) — free for commercial use, provided the copyright notice and [NOTICE](NOTICE) are retained.

Copyright 2022 Khalid Ait Bellahs.
