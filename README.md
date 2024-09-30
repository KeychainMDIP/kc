[![unit-test](https://github.com/KeychainMDIP/kc/actions/workflows/unit-test.yml/badge.svg)](https://github.com/KeychainMDIP/kc/actions/workflows/unit-test.yml) [![Coverage Status](https://coveralls.io/repos/github/KeychainMDIP/kc/badge.svg?branch=main)](https://coveralls.io/github/KeychainMDIP/kc?branch=main)

# kc

Keychain (kc) is the reference implementation of the Multi Dimensional Identity Protocol ([MDIP](/docs/mdip/scheme)).
Details on each command can be found in the [CLI User Manual](https://keychain.org/docs/keychain/clients/cli/) and the [Keymaster WebUI User Manual](https://keychain.org/docs/keychain/clients/webui/).

## Quick start

Recommended system requirements: 
- GNU/Linux OS with [docker](https://www.docker.com/) for containerized operation
- node 18.15.0 and npm 10.8.2 or newer for manual and local operation
- minimum of 8Gb RAM if operating a full trustless node

```
$ git clone https://github.com/KeychainMDIP/kc
$ cd kc
$ cp sample.env .env
$ ./start-node
```
## Node configuration

Customize your node in the kc/.env file. 

```
KC_UID=1000                                        # Docker host UID 
KC_GID=1002                                        # Docker host GID
KC_NODE_NAME=anon                                  # Hyperswarm node name
KC_NODE_ID=anon                                    # Node Keymaster DID name
KC_GATEKEEPER_REGISTRIES=hyperswarm,TESS,TBTC,TFTC # Supported DID Registries
...
{adjust registry details for advanced users only}
```

Once your node is operational (start-node), you can setup local dependencies and manage your server using local CLI wallet and other command line tools:

```
$ npm ci                                     # Installs all node package dependencies
$ ./kc -h                                    # Displays kc CLI help
$ ./kc create-id anon TBTC                   # Creates Node Keymaster DID name (set as KC_NODE_ID in .env)
$ ./scripts/tbtc-cli createwallet mdip       # Creates MDIP wallet for Bitcoin Testnet registry
$ ./scripts/tbtc-cli getnewaddress           # Get a new address to fund Bitcoin Testnet wallet
$ ./scripts/tbtc-cli getwalletinfo           # Get a general status of confirmed and incoming funds
```

## Command line interface wallet
Use the CLI `./kc` or the web app at http://localhost:4226 to access the server-side wallet.
Use the web app at http://localhost:4224 to access a client-side (browser) wallet.


```
$ ./kc
Usage: keychain-cli [options] [command]

Keychain CLI tool

Options:
  -V, --version                              output the version number
  -h, --help                                 display help for command

Commands:
  accept-credential <did> [name]             Save verifiable credential for current ID
  add-name <name> <did>                      Adds a name for a DID
  backup-id                                  Backup the current ID to its registry
  backup-wallet                              Backup wallet to encrypted DID and seed bank
  bind-credential <file> <did>               Create bound credential for a user
  check-wallet                               Validate DIDs in wallet
  create-asset <file>                        Create an asset from a JSON file
  create-challenge [file] [name]             Create challenge (optionally from a file)
  create-challenge-cc <did> [name]           Create challenge from a credential DID
  create-credential <file> [name]            Create credential from schema file
  create-id <name> [registry]                Create a new decentralized ID
  create-response <challenge>                Create a response to a challenge
  create-schema <file> [name]                Create schema from a file
  create-template <schema>                   Create a template from a schema
  create-wallet                              Create new wallet (or show existing wallet)
  decrypt-did <did>                          Decrypt an encrypted message DID
  decrypt-json <did>                         Decrypt an encrypted JSON DID
  encrypt-file <file> <did>                  Encrypt a file for a DID
  encrypt-msg <msg> <did>                    Encrypt a message for a DID
  fix-wallet                                 Remove invalid DIDs from the wallet
  group-add <group> <member>                 Add a member to a group
  group-create <name>                        Create a new group
  group-remove <group> <member>              Remove a member from a group
  group-test <group> [member]                Determine if a member is in a group
  help [command]                             display help for command
  import-wallet <recovery-phrase>            Create new wallet from a recovery phrase
  issue-credential <file> [registry] [name]  Sign and encrypt a bound credential file
  list-ids                                   List IDs and show current ID
  list-issued                                List issued credentials
  list-names                                 Lists names of DIDs
  poll-create <file> [name]                  Create poll
  poll-publish <poll>                        Publish results to poll, hiding ballots
  poll-reveal <poll>                         Publish results to poll, revealing ballots
  poll-template                              Generate a poll template
  poll-unpublish <poll>                      Remove results from poll
  poll-update <ballot>                       Add a ballot to the poll
  poll-view <poll>                           View poll details
  poll-vote <poll> <vote> [spoil]            Vote in a poll
  publish-credential <did>                   Publish the existence of a credential to the current user manifest
  recover-id <did>                           Recovers the ID from the DID
  recover-wallet [did]                       Recover wallet from seed bank or encrypted DID
  remove-id <name>                           Deletes named ID
  remove-name <name>                         Removes a name for a DID
  resolve-did <did> [confirm]                Return document associated with DID
  resolve-did-version <did> <version>        Return specified version of document associated with DID
  resolve-id                                 Resolves the current ID
  reveal-credential <did>                    Reveal a credential to the current user manifest
  revoke-credential <did>                    Revokes a verifiable credential
  rotate-keys                                Rotates keys for current user
  show-mnemonic                              Show recovery phrase for wallet
  show-wallet                                Show wallet
  sign-file <file>                           Sign a JSON file
  unpublish-credential <did>                 Remove a credential from the current user manifest
  use-id <name>                              Set the current ID
  verify-file <file>                         Verify the signature in a JSON file
  verify-response <response>                 Decrypt and validate a response to a challenge
```

## admin-cli 

Use the admin CLI to manage and view status of your server's DID registry operations.

```
$ ./admin
Usage: admin-cli [options] [command]

Admin CLI tool

Options:
  -V, --version                                                output the version number
  -h, --help                                                   display help for command

Commands:
  clear-queue <registry> <batch>                               Clear a registry queue
  create-batch <registry>                                      Create a batch for a registry
  export-batch                                                 Export all events in a batch
  export-did <did>                                             Export DID to file
  export-dids                                                  Export all DIDs
  get-dids [updatedAfter] [updatedBefore] [confirm] [resolve]  Fetch all DIDs
  hash-dids <file>                                             Compute hash of batch
  help [command]                                               display help for command
  import-batch <file>                                          Import batch of events
  import-batch <did> [registry]                                Import a batch
  import-did <file>                                            Import DID from file
  import-dids <file>                                           Import DIDs from file
  list-registries                                              List supported registries
  perf-test [full]                                             DID resolution performance test
  reset-db                                                     Reset the database to empty
  resolve-did <did> [confirm]                                  Return document associated with DID
  resolve-seed-bank                                            Resolves the seed bank ID
  show-queue <registry>                                        Show queue for a registry
```

## Upgrade

To upgrade to the latest version:

```
$ ./stop-node
$ git pull
$ ./start-node
```
