# Keychain MDIP Full Trustless Node Deployment Guide

Keychain MDIP is a suite of software tools, libraries, and services that implement the Multi-Dimensional Identity Protocol as defined and documented at [keychain.org](https://keychain.org). This document refers to the [MDIP v.0.3-beta release](https://github.com/KeychainMDIP/kc/releases/tag/v0.3-beta).

There are countless ways to deploy MDIP technology. These guidelines reflect current lessons learned and best practices. Feedback, recommendations, and additional best practices are welcome. Recommendations can be sent by opening an [issue](https://github.com/KeychainMDIP/kc/issues) against this document to share your experience with MDIP; these may be incorporated in future versions of this document.

## What is an MDIP Node?

MDIP *Nodes* provide the services required to interact with other MDIP nodes in a fully peer-to-peer trustless fashion; the network of Nodes being able to reach bysantine consensus on sequences of user-generated MDIP DID operations. An MDIP Node is composed of multiple subsystems, each providing essential services for protocol operations.

Services provided by a *Full* or *"Trustless" Node* includes: 
1. MDIP Gatekeeper API for DID operations
2. Local Database and Storage for DIDs and MDIP operations retention
3. Data Swarming Protocol for DIDs and MDIP operations distribution
4. One or more Registry Mediator System(s) for DIDs and MDIP operations registration.
5. One or mode Blockchain Network for decentralized consensus on order of DID operations.

### Communication Between MDIP Nodes

At the end of this installation guide, a full MDIP Node will expose limited and selected services over HTTP/SSL on port 443. All other ports can be firewalled. MDIP Nodes communicate with each other during the documents Distribution and Registration processes. 

- Document Distribution is *fast* and performed using the [Hyperswarm Protocol](https://github.com/holepunchto/hyperswarm). When a Keymaster Client presents a valid MDIP operation to the Gatekeeper API, the Gatekeeper communicates the operation to other Gatekeepers over a public Hyperswarm channel. Distribution of a DID is near-real-time.
  
- Document Registration is *immutable* and performed using the MDIP Satoshi Mediator and associated Blockchain software. DIDs are registered on a ledger to evidence an order of operation across all MDIP nodes. Registration of a DID is a parallel asynchronous process that occurs at "block" speed.

### Creating MDIP Operations

A system is said to be an MDIP Client if it implements MDIP Keymaster functionality. The MDIP Keymaster library and tools made available in this repository implement functionality to create valid MDIP operations. MDIP Keymaster is available as a REST OpenAPI interface, Command Line Interface, Web User Interface, NodeJS and Python SDKs, npm library, with more additions planned.

Each Keymaster Client manages a **private seed and key** used to sign or decrypt MDIP operations for a specific wallet.

MDIP Nodes that need to issue MDIP Challenges, verify Responses, issue Credentials, etc will need an MDIP Keymaster to manage the server's MDIP Wallet containing the keys to the server's identity on the network.

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

## Systems Requirement
The resource estimates and recommendations below are early estimates and are still under development. 

MDIP operations begin when the MDIP Gatekeeper receives a request from a Keymaster client. From the perspective of a Keymaster (MDIP client), all Gatekeepers are *the same* in the sense that they expose the same MDIP interfaces (REST OpenAPI API and WebUI). MDIP Gatekeepers Nodes do not have any visibility in the keys held securely by each MDIP Keymaster Client.

Another important consideration when running an MDIP node are the blockchain registries. Testnet registries are resource-friendly, but operating a full Bitcoin node requires significant resources that are beyond the scope of this document. The MDIP Satoshi Mediator can be configured to connect to any of the supported networks.

MDIP components communicate with one another using their respective APIs. It is possible although not necessary to deploy any MDIP component on dedicated machines. Excluding Blockchain Nodes, the MDIP Gatekeeper is the most resource hungry subsystem in terms of CPU, Memory, and Disk usage. The requirements below assume all components share the same hardware environment.

### Hardware Resources
- 8GB of RAM available for MDIP components
- 80GB of disk available for MDIP database
- Fixed IP address for named servers

### Software Dependencies
- Linux OS v.5+
- Up-to-date Docker
- NodeJS v.18.15.0
- git cli configured as alternative to manual download

### Operating System Preparations
MDIP requires minimal system preparation. All MDIP services are implemented in NodeJS, compiled and containerized using Docker and launched using Docker Compose. The repository (see directory structure review below) contains convenient shell scripts used to configure and manage an MDIP node.

It is recommended that a user account be created to run all MDIP components; the account's UID and GID will be required to configure the MDIP Docker containers. Likewise, proper disk space must be prepared and allocated for the MDIP node. All MDIP services write their data files in a `data` subdirectory, which can be sized according to a node's desired data retention policy.

### OS Preparation Checklist:
- Create a `mdip` user account for MDIP
    - note uid/gid numerical values returned by `id` command
    - grant `sudo` privileges for admin convenience 
- Create a data disk:
    - sufficient disk space allocated (80Gb+)
    - automatically mounted on system reboot (ex: `/mnt/mdip-data`) 
    - grant `mdip` uid/gid write permission
- Procure & configure fixed public-facing server IP address
    - configure DNS sub-domain to point to MDIP Node fixed IP address
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

```
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

```
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

### Customizing docker-compose.yml 
Another important file controlling the behavior of an MDIP node is the `docker-compose.yml` file. Although no changes to this file are necessary, a node operator will want to be familiar with the ports and variables used for each MDIP service. This file show how each components is launched.

Note that the TESS network is being deprecated. If installing v.0.3-beta, a node operator can practice customizing the docker-compose.yml file by removing the `tess-node` and `tess-mediator` sections.

Operators wanting to operate MDIP in a Kubernetes or other type of virtualized environments will find the environment variable dependencies for each MDIP component in the `docker-compose.yml` file. 

### Launching the MDIP Node

NodeJS dependencies should be resolved both locally on the Host and within the Docker containers. Dependencies resolved on the host machine enables command-line admin tools and scripts. The following command will launch the installation of all npm package dependencies for MDIP.

```
npm i
```

The next step will create and launch the docker containers. 
```
./start-node
```

On the first run, the `start-node` command will take up to 15 minutes to prepare the docker containers needed by the MDIP node. This will include Bitcoin Testnet and Feathercoin Testnet as registries. 

The script contains 2 commands: 
```
docker compose build "$@"
docker compose up "$@"
```

The *build* process will download numerous containers and dependencies as defined in the repository's Dockerfiles. The *up* command will launch the MDIP Node. The MDIP Node is considered `online` once the following messages appear in the Gatekeeper logs: 

```
Oct 16 18:11:49 mdip-gatekeeper start-node[3151048]: gatekeeper-1     | Server is running on port 4224, persisting with json
Oct 16 18:11:49 mdip-gatekeeper start-node[3151048]: gatekeeper-1     | Supported registries: hyperswarm,TESS,TBTC,TFTC
Oct 16 18:11:50 mdip-gatekeeper start-node[3151048]: gatekeeper-1     | GET /api/v1/ready 200 9.088 ms - 4
Oct 16 18:11:50 mdip-gatekeeper start-node[3151048]: hyperswarm-1     | Gatekeeper service is ready!
```

Likewise, the MDIP Node's Keymaster becomes available once the following logs are seen: 
```
Oct 16 18:11:53 mdip-gatekeeper start-node[3151048]: keymaster-1      | Gatekeeper service is ready!
Oct 16 18:11:53 mdip-gatekeeper start-node[3151048]: keymaster-1      | keymaster server running on port 4226
Oct 16 18:11:53 mdip-gatekeeper start-node[3151048]: keymaster-1      | Error: No current ID
```
We will resolve the `No current ID` error in the next section.

### Post-Launch Server Configuration
Now that our MDIP Node is online, we can create an agent DID for the Node and setup the wallets for blockchain registries. 

This section will also cover automated launch of MDIP Services using [systemd](https://systemd.io/) and protection of selected MDIP API end-points using a combination of [nginx](https://nginx.org/) as a reverse-proxy and [certbot](https://certbot.eff.org/) for SSL certificates.

#### Node Agent DID Creation

The MDIP Node's Keymaster wallet is located in `data/wallet.json`. There are two clients available to manage your server wallet: 
- `kc` Command Line Interface
- Keymaster Web User Interface on `http://localhost:4226`

This document will provide examples using the `kc` CLI tool. The following command will create a new wallet and show its content:

```
./kc create-wallet
```

We can now create an Agent DID for our MDIP Node. This DID should be given an aliased name that matches the `KC_NODE_ID` environment variable. The following command will create this new DID and schedule it for registration on the Bitcoin Blockchain (to be configured below). 

```
./kc create-id mynodeDID TBTC
```

The `./kc show-wallet` command will show an updated JSON wallet containing the newly created DID. To resolve a specific DID Document, use the command `./kc resolve-did mynodeDID` and replace mynodeDID with a specific DID or aliased name.

#### DID Registries Setup

MDIP v.0.3-beta currently support 2 decentralized registries: Bitcoin Testnet4 and Feathercoin Testnet. More registries will become available over time. Decentralized registries are an important part of decentralizing identitity; the Registry contains the concensus on order of MDIP operations. 

By default, the MDIP Satoshi Mediator will be looking for a wallet named `mdip`. The following command will create that wallet; the Bitcoin Testnet node is configured to store its data in the `data/tbtc` directory.

```
./scripts/tbtc-cli createwallet mdip
```


./scripts/tbtc-cli 
- Registries setup
- Systemd setup
- nginx setup

### Automating Launch
- Systemd setup
- ReLaunch & Test

## Using an MDIP Node

### Basic Tests and Common Links
- Gatekeeper Public Web Wallet
- Keymaster Private Wallet (web and cli)
- Gatekeeper API (private or public)

### Securing a generic system or website with MDIP
- nginx mdip-auth session router setup 
- mdip challenge/response examples

### MDIP authentication demo site
- Installing auth-demo
- Using auth-demo
- Customizing auth-demo
