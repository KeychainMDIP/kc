# Keychain MDIP Full Trustless Node Deployment Guide

Keychain MDIP is a suite of software tools, libraries, and services that implement the Multi-Dimensional Identity Protocol as defined and documented at [keychain.org](https://keychain.org). This document uses the [MDIP v.0.3-beta release](https://github.com/KeychainMDIP/kc/releases/tag/v0.3-beta).

There are countless ways to deploy MDIP technology. These guidelines reflect current lessons learned and best practices. Feedback, recommendations, and additional best practices are welcome! Please open an [issue](https://github.com/KeychainMDIP/kc/issues) against this document to share your experience with MDIP; these may be incorporated in future versions of this document.

## What is an MDIP Node?

MDIP *Nodes* provide the services required to interact with other MDIP nodes in a fully peer-to-peer trustless fashion; the network of Nodes being able to reach bysantine consensus on sequences of user-generated MDIP DID operations. An MDIP Node is composed of multiple subsystems, each providing essential services for protocol operations.

Services provided by a *Full* or *"Trustless" Node* includes: 
1. MDIP Gatekeeper API for DID operations (ex: create, resolve, update, revoke).
2. Local Database and Storage for DID document retention.
3. Data Swarming Protocol for DID document distribution.
4. One or more Registry Mediator System(s) for DID registration (batch, import & export).
5. One or mode Blockchain Network for decentralized consensus on order of DID operations.

### Communication Between MDIP Nodes

MDIP *nodes* communicate with each other using the DID Distribution and Registration processes. 

- Document Distribution is *fast* and performed using the [Hyperswarm Protocol](https://github.com/holepunchto/hyperswarm). When a Keymaster Client presents a valid MDIP operation to the Gatekeeper API, the Gatekeeper quickly communicates the operation to other gatekeepers over a public Hyperswarm channel. Distribution of a DID is near-real-time.
  
- Document Registration is *immutable* and performed using the MDIP Satoshi Mediator and associated Blockchain software. DIDs are registered on a ledger to evidence an order of operation across all MDIP nodes. Registration of a DID is a parallel asynchronous process that occurs at "block" speed.

### Creating MDIP Operations

A system is said to be an MDIP *client* if it implements MDIP Keymaster functionality. The MDIP Keymaster library and tools made available in this repository implement functionality to create valid MDIP operations. MDIP Keymaster is available as a REST OpenAPI interface, Command Line Interface, Web User Interface, NodeJS and Python SDKs, npm library, with more additions planned.

Each Keymaster client manages a **private seed and key** used to sign or decrypt MDIP operations for a specific wallet.

MDIP Nodes that need to issue MDIP Challenges, verify Responses, issue Credentials, etc will need an MDIP Keymaster to manage the server's MDIP Wallet containing the keys to the server's identity on the network.

MDIP operators can interact with their server's Keymaster in multiple ways: 
- use the `./kc` CLI tool or
- use the Keymaster WebUI at `http://localhost:4226` or
- use the Keymaster REST OpenAPI at `http://localhost:4226/api/v1/`

The MDIP [Integration Guide](integration_guide.md) focuses on Keymaster deployments, Keymaster OpenAPI interface, and integration of MDIP wallet functionality with 3rd party applications.

### MDIP Components
![MDIP-components](https://github.com/user-attachments/assets/c88a33f0-aa61-48b9-a62a-ca956f1038d9)

All the MDIP components illustrated above are composed together using Docker Compose in the official ['kc' v.0.3-beta repository](https://github.com/KeychainMDIP/kc/releases/tag/v0.3-beta). The repository provides a simple [`start-node`](https://github.com/KeychainMDIP/kc/blob/v0.3-beta/start-node) script that will compile, dockerize, and launch all the components. The convenience of this script will be preserved as we explore configuration and deployment options below. 

Note that each of the MDIP components can also be manually executed using native nodeJS commands. The Dockerfile for each component will reveal the particular command being executed within the Docker environment.

Using the [Dockerfile.gatekeeper](https://github.com/KeychainMDIP/kc/blob/v0.3-beta/Dockerfile.gatekeeper) as an example, we see the command used to launch the Gatekeeper API: 
`CMD ["node", "server/src/gatekeeper-api.js"]`

While perhaps not optimal for a production environment, developement environments can be deployed with all the required components on a single moderately-sized server. The statistics below demonstrate a typical environment:

![MDIP-resources](https://github.com/user-attachments/assets/7d63d4dc-fa51-4254-b9ad-94b91d98f78d)

- kc-gatekeeper-1 is the MDIP Gatekeeper API process.
- kc-keymaster-1 is a Keymaster API to manage the server's MDIP identity.
- kc-hyperswarm-1 is the document distribution protocol built on [Hyperswarm](https://github.com/holepunchto/hyperswarm).
- kc-tftc-mediator-1 is the MDIP Mediator for Feathercoin Testnet
- kc-tbtc-mediator-1 is the MDIP Mediator for Bitcoin Testnet
- kc-tftc-node is a generic Feathercoin Testnet node
- kc-tbtc-node is a generic Bitcoin Testnet4 node

## Systems Requirement

