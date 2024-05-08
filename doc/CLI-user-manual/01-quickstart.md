---
title: Quickstart
sidebar_label: Quickstart
---

The Keychain-MDIP CLI is a user-facing tool used to interact with the MDIP sub-systems and networks.

The Keychain CLI brings together functionality from three important sub-components:

1. Decentralized Identity (DID) registration and management as defined by W3C DID Core.
1. Verifiable Credential (VC) attestation and management as defined by W3C VC Data Model.
1. Crypto keys and wallet management.

All the CLI commands are self-documented using the `--help` flag, or by running `kc` with no flags:

<details>

<summary><code>kc --help</code></summary>

```sh
Usage: keychain-cli [options] [command]

Keychain CLI tool

Options:
  -V, --version                               output the version number
  -h, --help                                  display help for command

Commands:
  accept-credential <did> [name]              Save verifiable credential for current ID
  add-name <name> <did>                       Adds a name for a DID
  attest-credential <file> [registry] [name]  Sign and encrypt a bound credential file
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
  group-add <group> <member>                  Add a member to a group
  group-create <name>                         Create a new group
  group-remove <group> <member>               Remove a member from a group
  group-test <group> [member]                 Determine if a member is in a group
  help [command]                              display help for command
  import-did <file>                           Import DID from file
  import-wallet <recovery-phrase>             Create new wallet from a recovery phrase
  list-ids                                    List IDs and show current ID
  list-names                                  Lists names of DIDs
  poll-create <file> [name]                   Create poll
  poll-publish <poll>                         Publish results to poll, hiding ballots
  poll-reveal <poll>                          Publish results to poll, revealing ballots
  poll-template                               Generate a poll template
  poll-unpublish <poll>                       Remove results from poll
  poll-update <ballot>                        Add a ballot to the poll
  poll-view <poll>                            View poll details
  poll-vote <poll> <vote> [spoil]             Vote in a poll
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

</details>

```bash{promptUser: user}
kc
```

> [!NOTE]
>Unless you edit your shell's `$PATH` variable, you need to invoke kc with a `./` prefix to run the script from the current directory:

```sh
./kc
```

Begin by creating a new identity. This will be described in more detail later, but try it now with your own first name:

```sh
kc create-id yourName
did:mdip:test:z3v8AuaYd1CGfC6PCQDXKyKkbt5kJ4o3h2ABBNPGyGNQfEQ99Ce
```

The long string returned starting with `did` will be unique to you. This is your new Decentralized IDentity (DID for short).

Think of a DID as a secure reference. Only the owner of the reference can change what it points to. What makes it decentralized is that anyone can discover what it points to without involving a third party.

Creating a new ID automatically creates a new wallet for your ID, which we will describe next.