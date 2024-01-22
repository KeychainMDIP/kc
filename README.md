# Quick start

requires: node v18+

```
$ git clone https://github.com/macterra/keychain-cli.git
$ cd keychain-cli
$ npm install
$ ./kc

Usage: keychain-cli [options] [command]

Keychain CLI tool

Options:
  -V, --version              output the version number
  -h, --help                 display help for command

Commands:
  show                       Show wallet
  create-id <name>           Create a new decentralized ID
  remove-id <name>           Deletes named ID
  list                       List IDs
  use <name>                 Set the current ID
  resolve-did <did>          Return document associated with DID
  encrypt-msg <msg> <did>    Encrypt a message for a DID
  encrypt-file <file> <did>  Encrypt a file for a DID
  decrypt-did <did>          Decrypt an encrypted data DID
  sign <file>                Sign a JSON file
  verify <file>              Verify the signature in a JSON file
  create-vc <file> <did>     Create verifiable credential for a DID
  attest-vc <file>           Sign and encrypt VC
  revoke-vc <did>            Revokes a verifiable credential
  save-vc <file>             Save verifiable credential for current ID
  verify-vp <did>            Decrypt and verify the signature in a Verifiable Presentation
  rotate-keys                Rotates keys for current user
  help [command]             display help for command
```
