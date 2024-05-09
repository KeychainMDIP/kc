---
title: Keychain-MDIP CLI User Manual
sidebar_label: User Manual
---

The CLI is a Command Line Interface to the Keychain implementation of the MultiDimensional Identity Protocol (MDIP). `kc` (short for KeyChain) is a script invoked in a unix-like terminal environment (bash, zsh, etc).

## Install Keychain & MDIP

The Keychain project is provided as a set individual processes that make up the components of an MDIP node. These components can optionally be built into Docker containers managed with docker compose, which is what this page will cover.

This process will clone the repository and run the scripts to build and run the Docker containers.

#### Prerequisites

Before following these steps, ensure that the system in question has:

- `git`,
- `docker` with the Docker Compose plugin,
- `node` version >=18.

1. Clone the git repository:

    ```sh
    git clone https://github.com/keychainMDIP/kc
    cd kc
    ```

1. Install the project dependencies:

    ```sh
    npm i
    ```

1. Create a `.env` file to define the following environment variables:

    ```sh title=".env"
    KC_GATEKEEPER_URL=http://localhost #Used by the kc CLI to communicate with the gatekeeper.
    KC_GATEKEEPER_PORT=4224 #If you change this port, update this variable on the system running kc (if separate).
    KC_NODE_NAME= #The name by which other nodes will identify yours. If blank, your node will show as "anon".
    KC_NODE_ID= #We will get this value in the next steps.
    ```

1. Before running a full node with all mediators, we'll first invoke the `docker-compose.yml` file. This configuration only creates a basic node:

    ```sh
    docker compose up
    ```

    This may take a few minutes while it builds and deploys the docker images, and syncs network data. When the `hyperswarm-1` and `gatekeeper-1` containers begin logging, you can proceed.

1. In a separate terminal, create an ID for your node. Replace `<NODE-NAME>` with a preferred name to identify this ID in your wallet:

    ```sh
    ./kc create-id <NODE-NAME>
    ```

    Copy the output (`did:mdip:...`) to use as the value of `KC_NODE_ID` in `.env`.

1. In the terminal running `docker compose`, execute `CTRL+C` to stop the process.

1. Now you can run your node with additional containers. The `start-node.sh` script will rebuild and start your containers with the bitcoin mediator included:

    ```sh
    sh node-start.sh
    ```

## Components of an MDIP node

Inspecting the `dc-btc.yml` file reveals several containers that house individual components of your MDIP node.

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