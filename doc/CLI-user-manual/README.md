---
title: Keychain-MDIP CLI User Manual
sidebar_label: User Manual
---

The CLI is a Command Line Interface to the Keychain implementation of the MultiDimensional Identity Protocol (MDIP). `kc` (short for KeyChain) is a script invoked in a unix-like terminal environment (bash, zsh, etc).

## Install Keychain & MDIP

The Keychain project is provided as a set of Docker containers managed with docker compose. This process will clone the repository and run the scripts to build and run the containers.

1. Clone the git repository:

  ```sh
  git clone https://github.com/keychainMDIP/kc
  cd kc
  ```

1. Install the project dependencies:

  ```sh
  npm i
  ```

1. Run the start script. This will build and run the docker containers which create your MDIP node:

  ```sh
  sh node-start.sh
  ```

  > [!NOTE]
  >
  > The first time you spin up an MDIP node it may take several minutes. MDIP can register DIDs on several blockchain ledgers, which requires an import of their current state.

## Components of an MDIP node

Inspecting the `dc-bts.yml` file reveals several containers that house individual components of your MDIP node.

### Gatekeeper

The gatekeeper container manages connectivity between you and the MDIP network (via the `kc` CLI tool). This allows users to run the node on one system while interacting with it using `kc` on another.

### Hyperswarm

[Hyperswarm](https://github.com/holepunchto/hyperswarm) is a distributed networking stack. MDIP uses a hyperswarm network as the default registry for ID DIDs.

### Tess Node and Mediator

These containers create a Tesseract blockchain node and mediate communication between its ledger and MDIP. Tesseract is used for testing blockchain support, and this feature may be dropped in future releases of MDIP.

### BTC Mediator

This container manages communication between MDIP and the Bitcoin ledger.

## The `kc` CLI

The `kc` CLI tool is how you can interact with your MDIP node directly. For more information, read on to [Quickstart](quickstart).