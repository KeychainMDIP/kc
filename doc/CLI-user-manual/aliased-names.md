---
title: Working with Aliased Names
sidebar_label: Aliased Names
sidebar_position: 80
---

## What is an alias name?

Throughout this documentation, we used "aliased names" to facilitate interactions with the kc command. Aliased names are stored in the private user wallet and are not communicated or available to other network peers. Names can be created for any type of DID (agent or asset) and so can represent other users or various VCs, schemas, etc.

## Adding a name

Adding a name will append a new alias to the current user's local wallet:

```sh
$ kc add-name david "did:mdip:z3v8AuabNBnymLADSwWpDJPdEhvt2kS5v7UXypjzPnkqfdnW6ri"
OK
```

## Listing names

Listing names will reveal the list of aliases stored in the current user's local wallet:

```json
$ kc list-names
{
    "vc-social-media": "did:mdip:z3v8AuahM2jN3QRaQ5ZWTmzje9HoNdikuAyNjsGfunGfLCGj87J",
    "charlie-homepage": "did:mdip:z3v8AuaamvoV6JnvnhJk3E1npohd3jxThPSXFAzZZ4WwzMrirbq",
    "charlie-parent": "did:mdip:z3v8Auabi92Gj2gFdrf6JCubbz4RL4auHAD5eZvz8zkAzkeaeHw",
    "req-charlie-homepage": "did:mdip:z3v8AuaWxFtpy6Sp5cpHCBQMrsxdMZVdrYTyXMk62p7n5hs4Tb4",
    "david": "did:mdip:z3v8AuabNBnymLADSwWpDJPdEhvt2kS5v7UXypjzPnkqfdnW6ri"
}
```

## Removing a name

Removing a name will delete an alias from the current user's local wallet:

```sh
$ kc remove-name david
OK
```