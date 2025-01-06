---
title: Keychain-MDIP CLI User Manual
experimental: true
sidebar_label: CLI
---

The CLI is a Command Line Interface to the Keychain implementation of the MultiDimensional Identity Protocol (MDIP). `kc` (short for KeyChain) is a script invoked in a unix-like terminal environment (bash, zsh, etc).

## Quickstart

The Keychain-MDIP CLI is a user-facing tool used to interact with the MDIP sub-systems and networks.

The Keychain CLI brings together functionality from three important sub-components:

1. Decentralized Identity (DID) registration and management as defined by W3C DID Core.
1. Verifiable Credential (VC) credential and management as defined by W3C VC Data Model.
1. Crypto keys and wallet management.

### Installation

Keychain is provided as a set of docker containers and scripts:

1. From your terminal, download the repository and move to it:

    ```sh
    # SSH
    git@github.com:KeychainMDIP/kc.git
    #HTTPS
    https://github.com/KeychainMDIP/kc.git

    cd kc
    ```

1. Copy `sample.env` to `.env`:

    ```env
    cp sample.env .env
    ```

1. Edit the `KC_NODE_ID` and `KC_NODE_NAME` with unique values. The remaining values will be covered in futher documentation:

    ```sh title=".env" {2-3}
    # Gatekeeper
    KC_DEBUG=false
    KC_NODE_NAME=mynode
    KC_NODE_ID=mynodeID
    KC_GATEKEEPER_DB=json
    KC_GATEKEEPER_REGISTRIES=hyperswarm,TBTC,TFTC

    ...
    ```

1. Run the keychain start script:

    ```sh
    # Tied to the shell session:
    ./start-node

    # Daemonized:
    ./start-node -d
    ```

1. There's also a script to stop Keychain:

    ```sh
    ./stop-node
    ```

### CLI

All the CLI commands are self-documented using the `--help` flag, or by running `kc` with no flags:

<details>

<summary><code>kc --help</code></summary>

```sh
Usage: keychain-cli [options] [command]

Keychain CLI tool

Options:
  -V, --version                              output the version number
  -h, --help                                 display help for command

Commands:
  accept-credential <did> [name]             Save verifiable credential for current ID
  add-group-member <group> <member>          Add a member to a group
  add-name <name> <did>                      Adds a name for a DID
  backup-id                                  Backup the current ID to its registry
  backup-wallet                              Backup wallet to encrypted DID and seed bank
  bind-credential <schema> <subject>         Create bound credential for a user
  check-wallet                               Validate DIDs in wallet
  create-asset <file>                        Create an asset from a JSON file
  create-challenge [file] [name]             Create challenge (optionally from a file)
  create-challenge-cc <did> [name]           Create challenge from a credential DID
  create-group <name>                        Create a new group
  create-id <name> [registry]                Create a new decentralized ID
  create-poll <file> [name]                  Create poll
  create-poll-template                       Generate a poll template
  create-response <challenge>                Create a response to a challenge
  create-schema <file> [name]                Create schema DID from schema file
  create-schema <file> [name]                Create schema from a file
  create-schema-template <schema>            Create a template from a schema
  create-wallet                              Create new wallet (or show existing wallet)
  decrypt-did <did>                          Decrypt an encrypted message DID
  decrypt-json <did>                         Decrypt an encrypted JSON DID
  encrypt-file <file> <did>                  Encrypt a file for a DID
  encrypt-message <message> <did>            Encrypt a message for a DID
  encrypt-wallet                             Encrypt wallet
  fix-wallet                                 Remove invalid DIDs from the wallet
  get-asset <did>                            Get asset by DID
  get-credential <did>                       Get credential by DID
  get-group <did>                            Get group by DID
  get-schema <did>                           Get schema by DID
  help [command]                             display help for command
  import-wallet <recovery-phrase>            Create new wallet from a recovery phrase
  issue-credential <file> [registry] [name]  Sign and encrypt a bound credential file
  list-assets                                List assets owned by current ID
  list-credentials                           List credentials by current ID
  list-groups                                List groups owned by current ID
  list-ids                                   List IDs and show current ID
  list-issued                                List issued credentials
  list-names                                 Lists names of DIDs
  list-schemas                               List schemas owned by current ID
  perf-test [N]                              Performance test to create N credentials
  publish-credential <did>                   Publish the existence of a credential to the current user manifest
  publish-poll <poll>                        Publish results to poll, hiding ballots
  recover-id <did>                           Recovers the ID from the DID
  recover-wallet [did]                       Recover wallet from seed bank or encrypted DID
  remove-group-member <group> <member>       Remove a member from a group
  remove-id <name>                           Deletes named ID
  remove-name <name>                         Removes a name for a DID
  resolve-did <did> [confirm]                Return document associated with DID
  resolve-did-version <did> <version>        Return specified version of document associated with DID
  resolve-id                                 Resolves the current ID
  reveal-credential <did>                    Reveal a credential to the current user manifest
  reveal-poll <poll>                         Publish results to poll, revealing ballots
  revoke-credential <did>                    Revokes a verifiable credential
  rotate-keys                                Generates new set of keys for current ID
  show-mnemonic                              Show recovery phrase for wallet
  show-wallet                                Show wallet
  sign-file <file>                           Sign a JSON file
  test-group <group> [member]                Determine if a member is in a group
  unpublish-credential <did>                 Remove a credential from the current user manifest
  unpublish-poll <poll>                      Remove results from poll
  update-poll <ballot>                       Add a ballot to the poll
  use-id <name>                              Set the current ID
  verify-file <file>                         Verify the signature in a JSON file
  verify-response <response>                 Decrypt and validate a response to a challenge
  view-poll <poll>                           View poll details
  vote-poll <poll> <vote> [spoil]            Vote in a poll
```

</details>

The following examples use a `$` to denote the shell prompt:

```bash{promptUser: user}
$ kc
```

> [!NOTE]
>Unless you edit your shell's `$PATH` variable, you need to invoke kc with a `./` prefix to run the script in the current directory:

```sh
$ ./kc
```

Begin by creating a new identity. This will be described in more detail later, but try it now with your own first name:

```sh
$ kc create-id yourName
did:mdip:test:z3v8AuaYd1CGfC6PCQDXKyKkbt5kJ4o3h2ABBNPGyGNQfEQ99Ce
```

The long string returned starting with `did` will be unique to you. This is your new Decentralized IDentity (DID for short).

Think of a DID as a secure reference. Only the owner of the reference can change what it points to. What makes it decentralized is that anyone can discover what it points to without involving a third party.

Creating a new ID automatically creates a new wallet for your ID, which we will describe next.
