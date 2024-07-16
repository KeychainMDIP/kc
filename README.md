[![unit-test](https://github.com/KeychainMDIP/kc/actions/workflows/unit-test.yml/badge.svg)](https://github.com/KeychainMDIP/kc/actions/workflows/unit-test.yml) [![Coverage Status](https://coveralls.io/repos/github/KeychainMDIP/kc/badge.svg?branch=main)](https://coveralls.io/github/KeychainMDIP/kc?branch=main)

# kc

kc is the reference implementation of the Multi Dimensional Identity Protocol ([MDIP](doc/DID-scheme/README.md)).
Details on each command can be found in the [CLI User Manual](doc/CLI-user-manual/README.md).

## Quick start

requires: node v18

```
$ git clone https://github.com/KeychainMDIP/kc
$ cd kc
$ npm install
```

Start the services in separate terminals:
```
node gatekeeper-api.js
node hyperswarm-mediator.js
```

OR

Start the services in docker (-d to run it in the background):
```
docker compose up [-d]
```

Use the CLI `./kc` (or `./dkc` to connect to docker services)


```
$ ./kc

Usage: kc [options] [command]

Keychain CLI tool

Options:
  -V, --version                               output the version number
  -h, --help                                  display help for command

Commands:
  accept-credential <did> [name]              Save verifiable credential for current ID
  add-name <name> <did>                       Adds a name for a DID
  issue-credential <file> [registry] [name]  Sign and encrypt a bound credential file
  backup-id                                   Backup the current ID to its registry
  backup-wallet                               Backup wallet to encrypted DID
  bind-credential <file> <did>                Create bound credential for a user
  create-challenge [file] [name]              Create challenge (optionally from a file)
  create-challenge-cc <did> [name]            Create challenge from a credential DID
  create-credential <file> [name]             Create credential from schema file
  create-id <name> [registry]                 Create a new decentralized ID
  create-response <challenge>                 Create a Verifiable Presentation from a challenge
  create-wallet                               Create new wallet (or show existing wallet)
  decrypt-did <did>                           Decrypt an encrypted message DID
  decrypt-json <did>                          Decrypt an encrypted JSON DID
  encrypt-file <file> <did>                   Encrypt a file for a DID
  encrypt-msg <msg> <did>                     Encrypt a message for a DID
  export-did <did>                            Export DID to file
  help [command]                              display help for command
  import-did <file>                           Import DID from file
  import-wallet <recovery-phrase>             Create new wallet from a recovery phrase
  list-ids                                    List IDs and show current ID
  list-names                                  Lists names of DIDs
  publish-credential <did>                    Publish the existence of a credential to the current user manifest
  recover-id <did>                            Recovers the ID from the DID
  recover-wallet <did>                        Recover wallet from encrypted DID
  remove-id <name>                            Deletes named ID
  remove-name <name>                          Removes a name for a DID
  resolve-did <did>                           Return document associated with DID
  resolve-id                                  Resolves the current ID
  reveal-credential <did>                     Reveal a credential to the current user manifest
  revoke-credential <did>                     Revokes a verifiable credential
  rotate-keys                                 Rotates keys for current user
  show-mnemonic                               Show recovery phrase for wallet
  show-wallet                                 Show wallet
  sign-file <file>                            Sign a JSON file
  unpublish-credential <did>                  Remove a credential from the current user manifest
  use-id <name>                               Set the current ID
  verify-file <file>                          Verify the signature in a JSON file
  verify-response <did>                       Decrypt and validate a Verifiable Presentation
```

