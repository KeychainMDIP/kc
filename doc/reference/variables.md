---
title: Environment Variables
---

| Default value          | Type   | Default value    | Description |
|:---------------------- | ------ |:---------------- |:----------- |
| KC_BTC_EXPORT_INTERVAL | number | 15               | Defines the number of minutes between gatekeeper queue scans.
| KC_BTC_FEE_INC         | number | 0.00001000       | Defines the incremental txn fee (RBF) in BTC.
| KC_BTC_FEE_MAX         | number | 0.00020000       | Defines the maximum txn fee in BTC.
| KC_BTC_FEE_MIN         | number | 0.00001500       | Defines the initial txn fee in BTC.
| KC_BTC_HOST            | string | localhost        |
| KC_BTC_IMPORT_INTERVAL | number | 1                | Defines the number of minutes between block scans.
| KC_BTC_PASS            | string | password         |
| KC_BTC_PORT            | number | 8332             |
| KC_BTC_USER            | string | username         |
| KC_BTC_WALLET          | string | beta             |
| KC_GATEKEEPER_PORT     | number | 4224             | Used by both `kc` and the gatekeeper instance to determine the communication port. |
| KC_GATEKEEPER_URL      | string | http://localhost | Used by `kc` to talk to a gatekeeper instance. |
| KC_NODE_ID             | string | none             |
| KC_NODE_ID             | string | none             | The registered DID for this MDIP node. |
| KC_NODE_NAME           | string | anon             | The friendly name for this MDIP node. |