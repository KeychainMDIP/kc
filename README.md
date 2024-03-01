# Quick start

requires: node v18

```
$ git clone https://github.com/KeychainMDIP/keychain-cli
$ cd keychain-cli
$ npm install
```

Start the services in separate terminals:
```
node server.js
node hyperswarm-monitor.js
```

OR

Start the services in docker (-d to run it in the background):
```
docker compose up [-d]
```

Use the CLI `./kc`(or `./dkc` to connect to docker services)


```
$ ./kc

Usage: keychain-cli [options] [command]

Keychain CLI tool

Options:
  -V, --version                               output the version number
  -h, --help                                  display help for command

Commands:
  new-wallet <recovery-phrase>                Create new wallet from a recovery phrase
  show-wallet                                 Show wallet
  show-mnemonic                               Show recovery phrase for wallet
  backup-wallet                               Backup wallet to encrypted DID
  recover-wallet <did>                        Recover wallet from encrypted DID
  create-id <name> <registry>                 Create a new decentralized ID
  resolve-id                                  Resolves the current ID
  backup-id                                   Backup the current ID to its registry
  recover-id <did>                            Recovers the ID from the DID
  remove-id <name>                            Deletes named ID
  list-ids                                    List IDs and show current ID
  use-id <name>                               Set the current ID
  rotate-keys                                 Rotates keys for current user
  resolve-did <did>                           Return document associated with DID
  encrypt-msg <msg> <did>                     Encrypt a message for a DID
  encrypt-file <file> <did>                   Encrypt a file for a DID
  decrypt-did <did>                           Decrypt an encrypted message DID
  decrypt-json <did>                          Decrypt an encrypted JSON DID
  sign-file <file>                            Sign a JSON file
  verify-file <file>                          Verify the signature in a JSON file
  create-credential <file> [name]             Create credential from schema file
  create-challenge <file> [name]              Create challenge from a file
  create-challenge-cc <did> [name]            Create challenge from a credential DID
  issue-challenge <challenge> <user>          Issue a challenge to a user
  bind-credential <file> <did>                Create bound credential for a user
  attest-credential <file> <registry> [name]  Sign and encrypt a bound credential file
  revoke-credential <did>                     Revokes a verifiable credential
  accept-credential <did>                     Save verifiable credential for current ID
  publish-credential <did>                    Publish the existence of a credential to the current user manifest
  reveal-credential <did>                     Reveal a credential to the current user manifest
  unpublish-credential <did>                  Remove a credential from the current user manifest
  create-response <challenge>                 Create a Verifiable Presentation from a challenge
  verify-response <did>                       Decrypt and validate a Verifiable Presentation
  add-name <name> <did>                       Adds a name for a DID
  remove-name <name>                          Removes a name for a DID
  list-names                                  Lists names of DIDs
  export-did <did>                            Export DID to file
  import-did <file>                           Import DID from file
  help [command]                              display help for command
```
