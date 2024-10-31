---
title: Keychain MDIP Full Trustless Node Deployment Guide
sidebar_label: Deployment
slug: deployment
---

Keychain MDIP is a suite of software tools, libraries, and services that implement the Multi-Dimensional Identity Protocol as defined and documented by the [MDIP DID Scheme](/docs/mdip/scheme). This document refers to the [MDIP v.0.3-beta release](https://github.com/KeychainMDIP/kc/releases/tag/v0.3-beta).

There are countless ways to deploy MDIP technology. These guidelines reflect current lessons learned and best practices. Feedback, recommendations, and additional best practices are welcome. Recommendations can be sent by opening an [issue](https://github.com/KeychainMDIP/kc/issues) against this document to share your experience with MDIP; these may be incorporated in future versions of this document. You can also comment diretly at the bottom of any docs page, provided you have a GitHub account.

## What is an MDIP Node?

MDIP **nodes** provide the services required to interact with other MDIP nodes in a fully peer-to-peer trustless fashion; the network of nodes being able to reach bysantine consensus on sequences of user-generated MDIP DID operations. An MDIP node is composed of multiple subsystems, each providing essential services for protocol operations.

Services provided by a **Full** or **"Trustless"** node includes:

1. MDIP Gatekeeper API for DID operations.
1. Local database and storage for DIDs and MDIP operations retention.
1. Data Swarming Protocol for DIDs and MDIP operations distribution.
1. One or more registry mediator systems for DIDs and MDIP operations registration.
1. One or mode blockchain networks for decentralized consensus on order of DID operations.

### Node Communication

At the end of this installation guide, a full MDIP node will expose limited and selected services over HTTP/SSL on port 443. All other ports can be firewalled. MDIP nodes communicate with each other during the documents Distribution and Registration processes.

- Document Distribution is *fast* and performed using the [Hyperswarm Protocol](https://github.com/holepunchto/hyperswarm). When a Keymaster Client presents a valid MDIP operation to the Gatekeeper API, the Gatekeeper communicates the operation to other Gatekeepers over a public Hyperswarm channel. Distribution of a DID is near-real-time.
  
- Document Registration is *immutable* and performed using the MDIP Satoshi Mediator and associated blockchain software. DIDs are registered on a ledger to evidence an order of operation across all MDIP nodes. Registration of a DID is a parallel asynchronous process that occurs at "block" speed.

### MDIP Operations

A system is said to be an MDIP Client if it implements MDIP Keymaster functionality. The MDIP Keymaster library and tools made available in this repository implement functionality to create valid MDIP operations. MDIP Keymaster is available as a REST OpenAPI interface, Command Line Interface, Web User Interface, NodeJS and Python SDKs, npm library, with more additions planned.

Each Keymaster Client manages a **private seed and key** used to sign or decrypt MDIP operations for a specific wallet.

MDIP nodes that need to issue MDIP Challenges, verify Responses, issue Credentials, etc will need an MDIP Keymaster to manage the server's MDIP Wallet containing the keys to the server's identity on the network.

MDIP operators can interact with their server's Keymaster in multiple ways:

- use the `./kc` CLI tool or
- use the Keymaster WebUI at `http://localhost:4226` or
- use the Keymaster REST OpenAPI at `http://localhost:4226/api/v1/`

The MDIP [Integration Guide](integration_guide.md) focuses on Keymaster deployments, Keymaster OpenAPI interface, and integration of MDIP wallet functionality with 3rd party applications.

### MDIP Components

![MDIP-components](https://github.com/user-attachments/assets/c88a33f0-aa61-48b9-a62a-ca956f1038d9)

All the MDIP components illustrated above are composed together using Docker Compose in the official ['kc' v.0.3-beta repository](https://github.com/KeychainMDIP/kc/releases/tag/v0.3-beta). The repository provides a simple [`start-node`](https://github.com/KeychainMDIP/kc/blob/v0.3-beta/start-node) script that will compile, dockerize, and launch all required MDIP components. The convenience of this script will be preserved as we explore configuration and deployment options below.

Note that each MDIP components can also be manually launched using native nodeJS commands. The Dockerfile for each component will reveal the particular shell command being executed within the Docker environment. Using the [Dockerfile.gatekeeper](https://github.com/KeychainMDIP/kc/blob/v0.3-beta/Dockerfile.gatekeeper) as an example, we see the command used to launch the Gatekeeper API:
`CMD ["node", "server/src/gatekeeper-api.js"]`

While perhaps not optimal for a production environment, developement environments can be deployed with all the required components on a single moderately-sized server. The statistics below demonstrate a typical development environment:

![MDIP-resources](https://github.com/user-attachments/assets/7d63d4dc-fa51-4254-b9ad-94b91d98f78d)

- kc-gatekeeper-1 is the [MDIP Gatekeeper](https://keychain.org/docs/mdip/scheme) API process.
- kc-keymaster-1 is a [Keymaster API](https://keychain.org/docs/keychain/library/api/) to manage the server's MDIP identity.
- kc-hyperswarm-1 is the document distribution protocol built on [Hyperswarm](https://github.com/holepunchto/hyperswarm).
- kc-tftc-mediator-1 is the MDIP Mediator for [Feathercoin Testnet](https://feathercoin.com/)
- kc-tbtc-mediator-1 is the MDIP Mediator for [Bitcoin Testnet](https://github.com/bitcoin/)
- kc-tftc-node is a generic Feathercoin Testnet node
- kc-tbtc-node is a generic [Bitcoin Testnet4](https://github.com/bitcoin/bitcoin/pull/29775) node

## Systems Requirements

The resource estimates and recommendations below are early estimates and are still under development.

MDIP operations begin when the MDIP Gatekeeper receives a request from a Keymaster client. From the perspective of a Keymaster (MDIP client), all Gatekeepers are *the same* in the sense that they expose the same MDIP interfaces (REST OpenAPI API and WebUI). MDIP Gatekeepers nodes do not have any visibility in the keys held securely by each MDIP Keymaster Client.

Another important consideration when running an MDIP node are the blockchain registries. Testnet registries are resource-friendly, but operating a full Bitcoin node requires significant resources that are beyond the scope of this document. The MDIP Satoshi Mediator can be configured to connect to any of the supported networks.

MDIP components communicate with one another using their respective APIs. It is possible although not necessary to deploy any MDIP component on dedicated machines. Excluding blockchain nodes, the MDIP Gatekeeper is the most resource hungry subsystem in terms of CPU, Memory, and Disk usage. The requirements below assume all components share the same hardware environment.

### Hardware Resources

- 8GB of RAM available for MDIP components
- 80GB of disk available for MDIP database
- Fixed IP address for named servers

### Software Dependencies

- Linux OS v.5+
- Up-to-date Docker
- NodeJS v.18.15.0
- git cli configured as alternative to manual download

### Operating System Preparation

MDIP requires minimal system preparation. All MDIP services are implemented in NodeJS, compiled and containerized using Docker and launched using Docker Compose. The repository (see directory structure review below) contains convenient shell scripts used to configure and manage an MDIP node.

It is recommended that a user account be created to run all MDIP components; the account's UID and GID will be required to configure the MDIP Docker containers. Likewise, proper disk space must be prepared and allocated for the MDIP node. All MDIP services write their data files in a `data` subdirectory, which can be sized according to a node's desired data retention policy.

### OS Preparation Checklist

- Create a `mdip` user account for MDIP
  - note uid/gid numerical values returned by `id` command
  - grant `sudo` privileges for admin convenience 
- Create a data disk:
  - sufficient disk space allocated (80Gb+)
  - automatically mounted on system reboot (ex: `/mnt/mdip-data`) 
  - grant `mdip` uid/gid write permission
- Procure & configure fixed public-facing server IP address
  - configure DNS sub-domain to point to MDIP node fixed IP address
  - example: `mdip.yourdomain.dev.	300	IN	A	34.66.0.100`
- Install & configure `git` command-line interface for `mdip` user
  - see: [git-scm.com](https://git-scm.com/downloads/linux)
- Install nginx reverse-proxy engine
  - see: [docs.nginx.com](https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-open-source/)
- Install `certbot` for SSL certificate support
  - see: [certbot.eff.org](https://certbot.eff.org/instructions?ws=nginx&os=snap&tab=standard)

## Installation and Configuration

The installation and configuration instructions below provide only one of the countless ways to deploy MDIP functionality. System administrators and node operators should expect to make numerous additional local configurations to match their particular needs and environments.

Once the server environment is prepared, we begin the installation of MDIP. MDIP can be cloned from its source repository using the following commands:

```bash
git clone https://github.com/KeychainMDIP/kc
cd kc
git checkout v0.3-beta
```

This will checkout the current LTS v0.3-beta version. More adventurous node operators can consider the `main` nightly branch at their own risks!

### MDIP Directory Structure

Once a local copy of the repository is available, we can look at important parts of the repository:

| filename | notes |
|----------|-------|
| /data    | this directory will contain the data repositories for each MDIP components |
| /doc     | this directory contains a full local copy of the [MDIP documentation](https://keychain.org/docs/keychain/clients/cli/) |
| /packages | this directory contains MDIP npm packages |
| /packages/cipher | MDIP cryptography utilities for encryption/decryption and creating/verifying signatures |
| /packages/exceptions | Standard MDIP exception strings |
| /packages/gatekeeper | node library and SDK for MDIP gatekeeper |
| /packages/keymaster | node library and SDK for MDIP keymaster |
| /scripts | this directory contains useful MDIP command line interface scripts |
| /scripts/admin-cli.js | MDIP admin-cli tool to manage registry status, batching, queuing, import/export functions |
| /scripts/keychain-cli.js | MDIP cli tool to manage local `data/wallet.json` file |
| /scripts/tbtc-cli | Bitcoin Testnet cli tool to connect to TBTC Docker container | 
| /scripts/tbtc-logs | Bitcoin Testnet log viewer tool connecting autoimatically to TBTC Docker container |
| /services | this directory contains the source code for each MDIP REST API service |
| /services/gatekeeper/client | this directory contains a Keymaster WebUI client; exposed as `http://localhost:4224` |
| /services/gatekeeper/server | this directory contains the Gatekeeper API server; exposed as `http://localhost:4224/api/v1/` |
| /services/keymaster/client | this directory contains a PRIVATE Keymaster WebUI client to manage local `data/wallet.json` file; exposed as `http://localhost:4226` |
| /services/keymaster/server | this directory contains the PRIVATE Keymaster API server to interface with local `data/wallet.json` file; exposed as `http://localhost:4226/api/v1/` |
| /tests    | this directory contains useful test suites for the gatekeeper, keymaster, and complete MDIP workflow examples |
| /docker-compose.yml | this file contains the suite of Docker services that will be launched; advanced customization only! |
| /package.json | npm package dependencies required to launch MDIP components. |
| /sample.env | sample configuration file. Copy this file to a local .env file. Edit and configure .env file to your local needs |
| /admin | this will run the MDIP admin tool |
| /kc | this will run the Keychain command line interface client |
| /start-node | this command will launch the local node, including downloading docker containers, compiling source, and launching services as configured |
| /stop-node | this command will stop local node services |

### MDIP Environment Configuration

Configuration of an MDIP node is mainly done by editing a copy of the `sample.env` file into a locally customized `.env` file. Each command below should be executed from the `$HOME/kc` directory created when cloning the repository in the previous step.

```bash
cp sample.env .env
vi .env
```

The `.env` file will include the following customizable environment variables. At a minimum, make sure to configure the `#General` variables.

| environment variable | description |
|----------------------|-------------|
| # General            |             |
| KC_UID=1000          | value of your `mdip` user's uid |
| KC_GID=1000          | value of your `mdip` user's gid |
| KC_NODE_NAME=mynodeName | node name publicly visible over hyperswarm network |
| KC_NODE_ID=mynodeDID | MDIP Agent DID from local data/wallet.json file used to issue Challenges, Credentials as the server app |
|                      |             |
| # Gatekeeper         |             |
| KC_DEBUG=false       |             |
| KC_GATEKEEPER_DB=json | type of local data storage; leave as json for now with more options coming out soon |
| KC_GATEKEEPER_REGISTRIES=hyperswarm,TBTC,TFTC | list of DID registries supported by this node. TESS is being deprecated and can be removed if present |
| KC_GATEKEEPER_PORT=4224 | default MDIP port for Gatekeeper API |
| KC_GATEKEEPER_VERIFY_DB=true |     |
|                      |             |
| # CLI                |             |
| KC_GATEKEEPER_URL=http://localhost:4224 | this URL is used for client-facing apps, to be replaced with an SSL address once setup |
| # KC_KEYMASTER_URL=http://localhost:4226 | commented: clients use in-process keymaster library; set: uses localhost:4226 keymaster API |

Following these initial Gatekeeper configuration variables, the file will contain MDIP Registry Mediator configuration variables. The following block of variables is repeated for each *Satoshi Mediator* network. The Bitcoin Testnet block is used as an example here. No changes are needed in these blocks. The TESS registry was used in the early development of the protocol and is being deprecated; KC_TESS_* variables can be removed. 

WARNING: Changes to these variables are likely to **break** the Docker Compose functionality.

| environment variable | description |
|----------------------|-------------|
| # Bitcoin testnet4 mediator |      |
| KC_TBTC_HOST=localhost | host name for Bitcoin Testnet node |
| KC_TBTC_CHAIN=TBTC | MDIP registry name for Bitcoin Testnet network |
| KC_TBTC_NETWORK=testnet |  |
| KC_TBTC_START_BLOCK=38000 |  |
| KC_TBTC_PORT=48332 | Bitcoin Testnet node RPC port |
| KC_TBTC_USER=testnet4 | Bitcoin Testnet node RPC user |
| KC_TBTC_PASS=testnet4 | Bitcoin Testnet node RPC password |
| KC_TBTC_WALLET=mdip | Name of Bitcoin Testnet wallet to draw funds for transaction fees |
| KC_TBTC_IMPORT_INTERVAL=1 | MDIP Satoshi Mediator import loop wait interval (in minutes) |
| KC_TBTC_EXPORT_INTERVAL=1 | MDIP Satoshi Mediator export loop wait interval (in minutes) |
| KC_TBTC_FEE_MIN=0.00000200 | Bitcoin Testnet transaction minimum fee |
| KC_TBTC_FEE_MAX=0.00000600 | Bitcoin Testnet transaction maximum fee |
| KC_TBTC_FEE_INC=0 |  |

### Customizing the docker-compose.yml services

Another important file controlling the behavior of an MDIP node is the `kc/docker-compose.yml` file. Although no changes to this file are necessary, a node operator will want to be familiar with the ports and variables used for each MDIP service. This file shows and explains how each components is launched.

Note that the TESS network is being deprecated. If installing v.0.3-beta, a node operator can practice customizing the docker-compose.yml file by removing the `tess-node` and `tess-mediator` sections.

Operators wanting to operate MDIP in a Kubernetes or other type of virtualized environments will find the environment variable dependencies for each MDIP component in the `kc/docker-compose.yml` file.

#### gatekeeper service

Below is the MDIP `gatekeeper` definition.

- environment: this section contains environment variables *required* by a particular service
- volumes: this section defines the persistent storage data directory *required* for a particular service
- ports: this section defines the host port number that will be used by a particular service (gatekeeper default: 4224)

```yml
services:
  gatekeeper:
    build:
      context: .
      dockerfile: Dockerfile.gatekeeper
    image: keychainmdip/gatekeeper
    environment:
      - KC_GATEKEEPER_PORT=4224
      - KC_GATEKEEPER_DB=${KC_GATEKEEPER_DB}
      - KC_GATEKEEPER_REGISTRIES=${KC_GATEKEEPER_REGISTRIES}
    volumes:
      - ./data:/app/gatekeeper/data
    user: "${KC_UID}:${KC_GID}"
    ports:
      - "4224:4224"
```

#### keymaster service

Likewize, the MDIP `keymaster` has a Docker service definition in the `docker-compose.yml` file. An operator wanting to setup only a Keymaster service pointed to a 3rd party Hosted Gatekeeper server could customize their node to only launch only the `keymaster` service (keymaster default port: 4226)

```yml
  keymaster:
    build:
      context: .
      dockerfile: Dockerfile.keymaster
    image: keychainmdip/keymaster
    environment:
      - KC_KEYMASTER_PORT=4226
      - KC_GATEKEEPER_URL=${KC_GATEKEEPER_URL}
    volumes:
      - ./data:/app/keymaster/data
    user: "${KC_UID}:${KC_GID}"
    ports:
      - "4226:4226"
```

#### hyperswarm service

The MDIP Gatekeeper uses [Hyperswarm](https://github.com/holepunchto/hyperswarm) to distribute its known DIDs and DID Documents. The following section of the `kc/docker-compose.yml` file containerises `hyperswarm` service for MDIP. Note that the `KC_NODE_NAME` environment variable is exposed to the hyperswarm network as the vanity name for the node.

```yml
  hyperswarm:
    build:
      context: .
      dockerfile: Dockerfile.hyperswarm
    image: keychainmdip/hyperswarm-mediator
    environment:
      - KC_NODE_NAME=${KC_NODE_NAME}
      - KC_GATEKEEPER_URL=${KC_GATEKEEPER_URL}
    volumes:
      - ./data:/app/hyperswarm/data
    user: "${KC_UID}:${KC_GID}"
    depends_on:
      - gatekeeper
```

#### registry services (TBTC)

MDIP uses immutable ledgers to record evidence of a decentralized consensus on the order of operations that form the history of a DID. The MDIP protocol is blockchain agnostic and provides 2 Testnet examples to demonstrate the protocol's portability: Bitcoin Testnet4 and Feathercoin Testnet. Each DID is registered on a blockchain selected by the end-user at the time of creation. DID operations are batched and exported by the MDIP Mediator to its associated blockchain node.

In the example below, we use a generic bitcoin-code node configured to operate on testnet4. A similar service configuration block for Feathercoin Testnet is provided in the `kc` repository.

```yml
  tbtc-node:
    image: macterra/bitcoin-core:v27.99.0-2f7d9aec4d04
    volumes:
      - ./data/tbtc:/root/.bitcoin

  tbtc-mediator:
    build:
      context: .
      dockerfile: Dockerfile.sat
    image: keychainmdip/satoshi-mediator
    environment:
      - KC_GATEKEEPER_URL=${KC_GATEKEEPER_URL}
      - KC_NODE_ID=${KC_NODE_ID}
      - KC_SAT_CHAIN=TBTC
      - KC_SAT_NETWORK=testnet
      - KC_SAT_HOST=tbtc-node
      - KC_SAT_PORT=48332
      - KC_SAT_START_BLOCK=${KC_TBTC_START_BLOCK}
      - KC_SAT_USER=${KC_TBTC_USER}
      - KC_SAT_PASS=${KC_TBTC_PASS}
      - KC_SAT_WALLET=${KC_TBTC_WALLET}
      - KC_SAT_IMPORT_INTERVAL=${KC_TBTC_IMPORT_INTERVAL}
      - KC_SAT_EXPORT_INTERVAL=${KC_TBTC_EXPORT_INTERVAL}
      - KC_SAT_FEE_MIN=${KC_TBTC_FEE_MIN}
      - KC_SAT_FEE_MAX=${KC_TBTC_FEE_MAX}
      - KC_SAT_FEE_INC=${KC_TBTC_FEE_INC}
    volumes:
      - ./data:/app/satoshi/data
    user: "${KC_UID}:${KC_GID}"
    depends_on:
      - tbtc-node
```

### Install Local CLI Dependencies

NodeJS dependencies should be resolved both locally on the Host and within the Docker containers. Dependencies resolved on the host machine enables command-line admin tools and scripts. The following command will launch the `clean` installation of all npm package dependencies for MDIP.

```bash
npm ci
```

## Launching and Running an MDIP Node

Once the server requirements and dependencies are resolved, the next step will create and launch the docker containers.

```bash
./start-node
```

On the first run, the `start-node` command will take up to 15 minutes to prepare the docker containers needed by the MDIP node. This will include Bitcoin Testnet and Feathercoin Testnet as registries. 

The script contains 2 commands:

```bash
docker compose build "$@"
docker compose up "$@"
```

The *build* process will download numerous containers and dependencies as defined in the repository's Dockerfiles. The *up* command will launch the MDIP node. The MDIP node is considered `online` once the following messages appear in the Gatekeeper logs:

```log
Oct 16 18:11:49 mdip-gatekeeper start-node[3151048]: gatekeeper-1     | Server is running on port 4224, persisting with json
Oct 16 18:11:49 mdip-gatekeeper start-node[3151048]: gatekeeper-1     | Supported registries: hyperswarm,TESS,TBTC,TFTC
Oct 16 18:11:50 mdip-gatekeeper start-node[3151048]: gatekeeper-1     | GET /api/v1/ready 200 9.088 ms - 4
Oct 16 18:11:50 mdip-gatekeeper start-node[3151048]: hyperswarm-1     | Gatekeeper service is ready!
```

Likewise, the MDIP node's Keymaster becomes available once the following logs are seen:

```log
Oct 16 18:11:53 mdip-gatekeeper start-node[3151048]: keymaster-1      | Gatekeeper service is ready!
Oct 16 18:11:53 mdip-gatekeeper start-node[3151048]: keymaster-1      | keymaster server running on port 4226
Oct 16 18:11:53 mdip-gatekeeper start-node[3151048]: keymaster-1      | Error: No current ID
```

We will resolve the `No current ID` error in the next section.

### Post-Launch Server Configuration

Now that our MDIP Node is online, we can create an agent DID for the Node and setup the wallets for blockchain registries.

This section will also cover automated launch of MDIP Services using [systemd](https://systemd.io/) and protection of selected MDIP API end-points using a combination of [nginx](https://nginx.org/) as a reverse-proxy and [certbot](https://certbot.eff.org/) for SSL certificates.

#### Node Agent DID Creation

The MDIP node's Keymaster wallet is located in `data/wallet.json`. There are two clients available to manage your server wallet:

- `kc` Command Line Interface
- Keymaster Web User Interface on `http://localhost:4226`

This document will provide examples using the `kc` CLI tool. The following command will create a new wallet and show its content:

```bash
./kc create-wallet
```

We can now create an Agent DID for our MDIP node. This DID should be given an aliased name that matches the `KC_NODE_ID` environment variable. The following command will create this new DID and schedule it for registration on the Bitcoin blockchain (to be configured below).

```bash
./kc create-id mynodeDID TBTC
```

The `./kc show-wallet` command will show an updated JSON wallet containing the newly created DID. To resolve a specific DID Document, use the command `./kc resolve-did mynodeDID` and replace mynodeDID with a specific DID or aliased name.

#### DID Registries Setup

MDIP v.0.3-beta currently support 2 decentralized registries: Bitcoin Testnet4 and Feathercoin Testnet. More registries will become available over time. Decentralized registries are an important part of decentralizing identitity; the Registry contains the concensus on order of MDIP operations. Some releases may also have the Tesseract (TESS) registry, which is being deprecated in post-0.3-beta releases.

By default, the MDIP Satoshi Mediator will be looking for a wallet named `mdip`. The following command will create that wallet; the Bitcoin Testnet4 node is configured to store its data in the `data/tbtc` directory.

```bash
./scripts/tbtc-cli createwallet mdip
```

We can then create a new Bitcoin Testnet4 address with the following command:

```bash
./scripts/tbtc-cli getnewaddress
```

The new Bitcoin Testnet4 address should be used to *fund* the server's Bitcoin Testnet4 wallet. Below are 2 currently operational Testnet4 faucets:

- [https://mempool.space/testnet4/faucet](https://mempool.space/testnet4/faucet)
- [https://coinfaucet.eu/en/btc-testnet4/](https://coinfaucet.eu/en/btc-testnet4/)

You can view the `unconfirmed_balance` and `balance` of your wallet with the following command:

```bash
./scripts/tbtc-cli/getwalletinfo
```

The `tbtc-cli` script passes the command line arguments to the standard bitcoin node wallet operating inside the `tbtc-node` docker container. The commands above should also be replicated for other supported blockchains (ex: `./scripts/tftc-cli`).

### Automated Restart using Systemd

Systemd ([https://systemd.io/](https://systemd.io/)) is a popular service manager for Linux OS. The following simple configuration file can be used to launch an mdip node.  

```systemd
[Unit]
Description=MDIP Daemon Service

[Service]
Type=simple
WorkingDirectory=/home/mdip/kc
ExecStart=/home/mdip/kc/start-node
User=mdip

[Install]
WantedBy=multi-user.target
```

The copy/paste the content above in a `/etc/systemd/system/mdip.service` service file for systemd. You will need `sudo` or `root` privileges in order to change your server's autostart services. Once the service file is created, you can launch your mdip node with the following command:

```bash
sudo systemctl daemon-reload
sudo systemctl start mdip
```

To view the status of your node, you can use `journalctl` :

```bash
systemctl status mdip
```

To view the continuous logs of your node, you can use

```bash
journalctl -f -u mdip
```

Once the node is operating normally, the system can be configured to auto-start with the following: 

```bash
sudo systemctl enable mdip
```

### Understanding MDIP Logs and Launch Process

When you first launch an MDIP node, there will be multiple stages of readiness including:

1. MDIP Docker Containers Preparation
1. MDIP Gatekeeper Synchronization with MDIP Network ( node operational here)
1. MDIP Keymaster Connects to Gatekeeper once ready ( server wallet connects to node)
1. Blockchain node Synchronization with blockchain network
1. MDIP Mediator Discovery of MDIP Operations on blockchain registry (DIDs history validated here)

Below are log examples indicating your MDIP node's stage of readyness.

#### Log samples: Docker Containers

As we have seen, each MDIP component operates in its own Docker Container. The first logs seen when launching MDIP for the first time is the preparation of the Docker containers.

In subsequent launches the dockerfiles will be rebuilt or reused depending on whether the source files have changed.

```log
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #0 building with "default" instance using docker driver
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #1 [gatekeeper internal] load build definition from Dockerfile.gatekeeper
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #1 transferring dockerfile: 505B done
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #1 DONE 0.0s
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #3 [tbtc-mediator internal] load build definition from Dockerfile.sat
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #3 transferring dockerfile: 415B done
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #3 DONE 0.0s
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #4 [tftc-node internal] load build definition from Dockerfile.ftc
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #4 transferring dockerfile: 556B done
Oct 28 16:34:14 mdip-gatekeeper start-node[703548]: #4 DONE 0.0s
...
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-gatekeeper-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-keymaster-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-hyperswarm-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-mongodb-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-tftc-node-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-tbtc-node-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-tftc-mediator-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]:  Container kc-tbtc-mediator-1  Created
Oct 28 16:34:14 mdip-gatekeeper start-node[703710]: Attaching to gatekeeper-1, hyperswarm-1, keymaster-1, mongodb-1, tbtc-mediator-1, tbtc-node-1, tftc-mediator-1, tftc-node-1
```

#### Log samples: MDIP Gatekeeper Service

Upon launch, the gatekeeper process will attempt to conntect to its configured hyperswarm distribution process. 

The gatekeeper will build a local collection of published DIDs and begin verification of each document. Once available, the Gatekeeper will report being `ready` when queried on its local API: `curl http://localhost:4224/api/v1/ready`.

```log
...
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 59 did:test:z3v8AuaZDB5DyvYMXkaZBijtaoUZEAQVHShuffr6dRWtQmnL62W OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 60 did:test:z3v8AuaZjo9EKqTJLSW9DGTXFerRjCsH9Fp3Pmnv35F6njZm7aB OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 61 did:test:z3v8AuaUkujpZggLmWFG7DFqL5gmCo9bner2RZU8cD5EPwZcv8N OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 62 did:test:z3v8AuaWK2415KF3vaMLuGdizvzPSzcpzeRPKBykoAcK1twXwhP OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 63 did:test:z3v8AuaX8nDuXtLHrLAGmgfeVwCGfX9nMmZPTVbCDfaoiGvLuTv OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 64 did:test:z3v8AuabChKbzYnyw8TDH8wUzeVQa2AQGLGP32q27emzepDjQ3d OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 65 did:test:z3v8Auacu1CNBsHcadzwm2SYwkLMEuSeHhhncpUhhRKqZfL3tMP OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 66 did:test:z3v8AuadTptkdez7A2DoNjMRcqzUEVzQvBaUDLL9ufKTWskk87o OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 67 did:test:z3v8AuaiV29JNgqgVeaVrNj51rQu9YtkWgpuezkjWeUUqxsi6WA OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 68 did:test:z3v8AuaUqS7xVKXJCbkYHFt7qijszix3T39wVxUXL29P46YE2gu OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 69 did:test:z3v8AuahGKB5bJgCY4kvFGdKCyNP8QgM47Yd2tzcEUsN6EkygUn OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 70 did:test:z3v8AuaesXqNNmMENhZSuQSeqGbKdy5cogDUPduzWgdhnvKb5jF OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 71 did:test:z3v8AuagPcWQffRpfE7oHxccQVJAdk4sk4oNW6SAjPYD3syNAa8 OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 72 did:test:z3v8AuaW5UNaQ9u5bd4m6QX4aL82bP9cfuh93ZgvyryzhkjkGs9 OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 73 did:test:z3v8AuaTDz8s7wBZwhKcfnV59wEq2JoEi2FbcJJrE576AKuDvTa OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 74 did:test:z3v8Auai62TXdGDf3rnXHENaDzYM7NAdFeiz8kDhRV7Ch1L8FHv OK
Oct 28 16:34:20 mdip-gatekeeper start-node[703710]: gatekeeper-1     | 75 did:test:z3v8AuaYGdCpWyLKfcoP2if1CDTA74zGnh1VDReXuhe5zY3pSdt OK
...
Oct 28 16:35:30 mdip-gatekeeper start-node[705212]: gatekeeper-1     | 6987 did:test:z3v8AuaiDEX5skrxB1bHH4aE5Jp6QcubQ7gqnpPWwFpedVSxtsF OK
Oct 28 16:35:30 mdip-gatekeeper start-node[705212]: gatekeeper-1     | verifyDb: 56.681s
Oct 28 16:35:30 mdip-gatekeeper start-node[705212]: gatekeeper-1     | Server is running on port 4224, persisting with json
Oct 28 16:35:30 mdip-gatekeeper start-node[705212]: gatekeeper-1     | Supported registries: hyperswarm,TBTC,TFTC
Oct 28 16:35:32 mdip-gatekeeper node[95272]: Gatekeeper service is ready!
Oct 28 16:35:32 mdip-gatekeeper start-node[705212]: gatekeeper-1     | GET /api/v1/ready 200 - 7.745 ms 
```

#### Log samples: MDIP Keymaster Service

The logs below show a keymaster service connecting to a gatekeeper once the gatekeeper reports being ready for connections.

The keymaster process is an **administrative** tool and should not be exposed to unauthorized users and never to the public. The *key*master service running on port `4226` operates the server's MDIP identity used to issue challenges, decrypt documents, etc. The Keymaster will report being `ready` when queried on its local API: `curl http://localhost:4226/api/v1/ready`.

```log
Oct 28 16:35:34 mdip-gatekeeper start-node[705212]: hyperswarm-1     | Gatekeeper service is ready!
Oct 28 16:35:34 mdip-gatekeeper start-node[705212]: keymaster-1      | Gatekeeper service is ready!
Oct 28 16:35:34 mdip-gatekeeper start-node[705212]: keymaster-1      | keymaster server running on port 4226
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      | current ID: mynodeID
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: gatekeeper-1     | GET /api/v1/did/did:test:z3v8AuaebRuWwQNHLvSXPD59KoTqTky7cvDSJ88Tnjf9gp2ULTe 200 - 28.696 ms 
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      | {
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     "@context": "https://w3id.org/did-resolution/v1",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     "didDocument": {
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "@context": [
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |             "https://www.w3.org/ns/did/v1"
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         ],
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "id": "did:test:z3v8AuaebRuWwQNYLvSXPDIKoTqTky7cvDSJ88Tnjf9gp2ULTe",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "verificationMethod": [
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |             {
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                 "id": "#key-1",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                 "controller": "did:test:z3v8AuaebRuWwQNYLvSXPDIKoTqTky7cvDSJ88Tnjf9gp2ULTe",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                 "type": "EcdsaSecp256k1VerificationKey2019",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                 "publicKeyJwk": {
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                     "kty": "EC",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                     "crv": "secp256k1",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                     "x": "TVlYpOylDZr1BlIBKMU3295t_vkeBxPIwGhXg84",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                     "y": "XHoeZ6UQiHy390YTnTfuimLKWfNMnGOikSLGUkw"
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |                 }
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |             }
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         ],
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "authentication": [
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |             "#key-1"
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         ]
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     },
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     "didDocumentMetadata": {
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "created": "2024-10-16T18:11:50.850Z",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "version": 1,
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "confirmed": true
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     },
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     "didDocumentData": {},
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     "mdip": {
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "version": 1,
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "type": "agent",
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |         "registry": "TBTC"
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      |     }
Oct 28 16:35:35 mdip-gatekeeper start-node[705212]: keymaster-1      | }
```

#### Log samples: Blockchain Node (tBTC)

The `kc/docker-compose.yml` script will launch Bitcoin Testnet4 and Feathercoin Testnet nodes to be used as DID registries.

The following logs are generated when the Bitcoin node is launched. Note the default use of `testnet4="1"` in the Bitcoin configuration file now located in `kc/data/tbtc/bitcoin.conf`. Customizations to the connectivity between MDIP and its repositories must be reflected in both configurations files (registry and MDIP).

```log
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.770935Z Bitcoin Core version v27.99.0-2f7d9aec4d04 (release build)
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.771013Z Script verification uses 5 additional threads
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.771092Z Using the 'sse4(1way),sse41(4way),avx2(8way)' SHA256 implementation
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.879674Z Using RdSeed as an additional entropy source
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.879677Z Using RdRand as an additional entropy source
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881323Z Default data directory /root/.bitcoin
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881331Z Using data directory /root/.bitcoin/testnet4
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881342Z Config file: /root/.bitcoin/bitcoin.conf
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881359Z Config file arg: debug="0"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881368Z Config file arg: debugexclude="libevent"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881375Z Config file arg: debugexclude="leveldb"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881381Z Config file arg: debugexclude="tor"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881387Z Config file arg: discover="0"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881394Z Config file arg: keypool="1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881404Z Config file arg: logtimemicros="1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881413Z Config file arg: mocktime="0"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881442Z Config file arg: rest="1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881452Z Config file arg: rpcpassword=****
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881463Z Config file arg: rpcuser=****
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881472Z Config file arg: server="1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881484Z Config file arg: testnet4="1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881494Z Config file arg: txindex="1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881502Z Config file arg: uacomment="mdip-1"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881510Z Config file arg: [testnet4] rpcallowip="0.0.0.0/0"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881517Z Config file arg: [testnet4] rpcbind="0.0.0.0"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881524Z Config file arg: [testnet4] wallet="mdip"
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881532Z Command-line arg: printtoconsole=""
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881540Z Using at most 125 automatic connections (1048576 file descriptors available)
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.881712Z scheduler thread start
Oct 28 16:37:04 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:04.885815Z Binding RPC on address 0.0.0.0 port 48332
...
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.583276Z Initializing chainstate Chainstate [ibd] @ height -1 (null)
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.583358Z Opening LevelDB in /root/.bitcoin/testnet4/chainstate
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.598581Z Opened LevelDB successfully
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.598679Z Using obfuscation key for /root/.bitcoin/testnet4/chainstate: bba716c40aa18d67
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.631910Z Loaded best chain: hashBestChain=000000000000000f3b85cc00b4126131accec6e0e95a649eeb7c8b4fa38b5e81 height=52414 date=2024-10-27T20:11:36Z progress=1.000000
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.638516Z Opening LevelDB in /root/.bitcoin/testnet4/chainstate
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651019Z Opened LevelDB successfully
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651113Z Using obfuscation key for /root/.bitcoin/testnet4/chainstate: bba716c40aa18d67
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651142Z [Chainstate [ibd] @ height 52414 (000000000000000f3b85cc00b4126131accec6e0e95a649eeb7c8b4fa38b5e81)] resized coinsdb cache to 8.0 MiB
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651153Z [Chainstate [ibd] @ height 52414 (000000000000000f3b85cc00b4126131accec6e0e95a649eeb7c8b4fa38b5e81)] resized coinstip cache to 384.0 MiB
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651173Z init message: Verifying blocks…
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651189Z Verifying last 6 blocks at level 3
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.651212Z Verification progress: 0%
Oct 28 16:37:05 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T16:37:05.679435Z Verification progress: 16%
...
```

#### Log samples: MDIP Mediator (tBTC)

The `kc/docker-compose.yml` default configuration will launch an MDIP Satoshi Mediator process configured to import/export with the Bitcoin Testnet4 blockchain.

The logs below show the MDIP Mediator successfully exporting the a DID update operation to the TBTC registry.

```log
Oct 28 16:37:09 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | Waiting for TBTC node...
Oct 28 16:37:11 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | current block height: 52581
Oct 28 16:37:11 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | import loop waiting 1 minute(s)...
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | [
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |     {
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |         "type": "update",
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |         "did": "did:test:z3v8AuabA1TdC1GDvGoYkEXsESoJThCyuRekbn3fELkeGSGJa1e",
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |         "doc": {
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |     }
Oct 28 16:37:15 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | ]
...
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | {
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |     "hex": "0200000000010172471d5072fe4b3cca7b1280d12e3ae419bf021358f7fbde00c07bd9faf886a50100000000fdffffff0200000000000000003e6a3c6469643a746573743a7a3376384175616258426d4e4d50784c4454596e4655724c5173667835526a414479343348506a355758666f384e7546764a57c2450000000000001600141b3544273e9a63b04cba431d086563a780f84c15024730440220068107db0675ed3fe6c32b6a4f5e2523c26ddcdaed812fc9be5858eb3cbcb9ea022005a9a9d7927424112e87719835aa8f7f17df6b1373c32d1764f5528d085a17730121027e15ea510377a03013154c70e66a9851db5591e428c370f51e12f6bbd3a7016400000000",
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  |     "complete": true
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | }
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | 0.00017858000000000001
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-node-1      | 2024-10-28T19:43:17.461639Z [mdip] AddToWallet 4b52dfa95d7b9472147b2821a33c59cdd52bf1444b6c0feed4e7c8c0d9a6f798  new InMempool
Oct 28 16:37:17 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | Transaction broadcast with txid: 4b52dfa95d7b9472147b2821a33c59cdd52bf1444b6c0feed4e7c8c0d9a6f798
Oct 28 16:37:18 mdip-gatekeeper start-node[706734]: gatekeeper-1     | POST /api/v1/queue/TBTC/clear 200 650.769 ms - 4
Oct 28 16:37:18 mdip-gatekeeper start-node[706734]: tbtc-mediator-1  | export loop waiting 1 minute(s)...
```

## Secure Hosting an MDIP Node with nginx

nginx [https://nginx.org/](https://nginx.org/) is a popular web server and reverse proxy available for most operating systems.

nginx can be used to control and throttle access to server ports and hosted services like MDIP. The configuration files presented here are for educational purposes. Securing a server for online operations involves more than protecting a few ports; this document limits itself to MDIP-specific ports and services.

### Important MDIP Ports and Endpoints

A full MDIP node launched using the provided `kc/docker-compose.yml` configuration will only expose 2 new service ports on the Host machine:

```docker
keychainmdip/keymaster   0.0.0.0:4226->4226/tcp   kc-keymaster-1
keychainmdip/gatekeeper  0.0.0.0:4224->4224/tcp   kc-gatekeeper-1
```

When using Docker as an operating environment, other ports are used within the Docker network to mediate with 3rd party systems.

```docker
mongo:latest             27017/tcp kc-mongodb-1
bitcoin-core:v27.99.0    48332/tcp kc-tbtc-node-1
feathercoind             19337/tcp kc-tftc-node-1
```

None of the ports listed above should ever be directly addressable from the Internet. It is recommended that a firewall be setup to prevent access to these services.

### Basic nginx Hosting

The nginx configuration file below can be used to launch a live MDIP node that exposes only read-only gatekeeper end-points.

```nginx
#
# Basic read-only MDIP Gatekeeper server routes configuration for nginx
#
server {
    server_name mdip.mydomain.net; # Replace with your domain name
    access_log /var/log/mdip-node; 

    # Block POST and DELETE requests 
    if ($request_method !~ ^(GET|HEAD)$ ) {
      return 405;
    }

    # Returns {true} when server is ready
    location /api/v1/ready {
        proxy_pass http://localhost:4224/api/v1/ready;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        allow all;
    }

    # Allows public queries of node's database
    location /api/v1/did {
        proxy_pass http://localhost:4224/api/v1/did;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        allow all;
    }

    # Returns blockchain registries supported by the node
    location /api/v1/registries {
        proxy_pass http://localhost:4224/api/v1/registries;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        allow all;
    }

    # Returns node protocol version
    location /api/v1/version {
        proxy_pass http://localhost:4224/api/v1/version;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        allow all;
    }

    # Provides a generic MDIP Wallet web user interface with browser-side keys
    location / {
        proxy_pass http://localhost:4224;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        allow all;
    }
```

## Using an MDIP Node

This section contains tips and information on how to get started with your new MDIP node.

### Basic Tests and Common Links

The MDIP Gatekeeper offers a developer-friend identity wallet on port 4224 that can be used to interact with the protocol.

![Screenshot 2024-10-28 at 17 09 19](https://github.com/user-attachments/assets/6763e0a6-706b-418f-bd28-33efa6ea0cca)

Most of the Keymaster functions are available over the Keymaster WebUI. Documentation for the Keymaster WebUI is available on the [keychain.org](https://keychain.org/docs/keychain/clients/webui/) website.

#### Private Server-Side Wallet

MDIP is a peer-to-peer system. Interactions between human users and server hosts are

- Keymaster Private Wallet (web and cli)
- Gatekeeper API (private or public)

## Appendix (TBD)

### Securing a generic system or website with MDIP

- nginx mdip-auth session router setup
- mdip challenge/response examples

### MDIP authentication demo site

- Installing auth-demo
- Using auth-demo
- Customizing auth-demo

### MDIP Integration Guide

- Keymaster API
- Client and server keys
