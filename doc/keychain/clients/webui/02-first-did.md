---
title: Creating your first DID
sidebar_label: 'Your First DID'
author: Christian
---

The first time you visit https://mdip.keychain.org/, your browser will automatically generate a new MDIP Wallet. The keys and all information contained in an MDIP wallet is only available on the client-side. The screen below shows a blank MDIP wallet:

![New MDIP Keymaster Wallet](01.png)

An MDIP wallet may contain multiple Agent DIDs, or identities. Each DID can be registered on a Registry of the user's choice. Local-only and Hyperswarm global DID distribution are available along with an upcoming growing list of immutable ledgers like Bitcoin and many others.

![Bob DID](02.png)

The MDIP Wallet above now contains 1 Agent DID nicknamed "Bob". Once a DID is created, numerous new Keymaster wallet functions become available:

1. [IDENTITIES](./identities): User can create new Agent DIDs, backup/recover and/or remove undesired Identities.
1. [DIDS](./dids): User manage nicknames to known DIDs. Can be used to name any type of DIDs (agent, asset, groups, etc).
1. [GROUPS](./groups): Manages groups of DIDs. Create groups of any types of DIDs. Note: Groups are public.
1. SCHEMAS: Manage JSON schemas to be used for attesting credentials. Note: Schemas are public and reusable.
1. CREDENTIALS - HOLD: User can accept (hold) a credential with option to view & decrypt prior to acceptance.
1. CREDENTIALS - ISSUE: Issue a credential schema to an agent DID. User can fill-in the schema values.
1. AUTH: Create and/or respond to MDIP authentication challenges. WebUI only supports DID validation at this time.
1. WALLET: Wallet-level backup and restore methods. 12-words, upload/download, or in-network backups are available.