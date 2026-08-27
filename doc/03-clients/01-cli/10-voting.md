---
title: Voting
experimental: true
---

The MDIP protocol allows for near-endless forms of communication. This page covers the "group" and "poll" set of commands provided by the `kc` CLI tool, which demonstrate how MDIP can be used to perform secure voting.

In the examples below, we'll create a poll to decide the best flavor of ice cream.

## Voting Groups

Groups are simply collections of identity DIDs that are allowed to cast votes in a poll.

1. Create a new group:

    ```sh
    kc create-group icecream-tasters --name icecream-tasters
    did:test:klf75KJH6LKlh654LP4C7hexSVfDhFcSiZr8xfS1tg
    ```

1. Add members to the polling group using their DID:

    ```sh
    kc add-group-member icecream-tasters did:test:z3v8AuzzXKfwrt4Y3AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwjm8
    true
    ```

   Members can also be added using their [aliased names](./08-aliased-names.md):

    ```sh
    kc add-group-member icecream-tasters alice
    true
    ```

    If a member should be removed from a group, use `kc remove-group-member` with their DID or aliased name.

1. You can check to see if a DID is part of the group:

    ```sh
    kc test-group icecream-tasters bob
    false
    ```


## Polls

Polls are DID objects that follow a provided template to provide options, and collect and summarize votes.

1. Create a JSON file to define the poll using the `create-poll-template` command:

    ```sh
    kc create-poll-template > icecream-poll.json
    ```

1. Edit the poll file:

    ```json title="icecream-poll.json"
    {
        "type": "poll",
        "version": 1,
        "description": "Which flavor of ice cream is the best?",
        "roster": "did:test:klf75KJH6LKlh654LP4C7hexSVfDhFcSiZr8xfS1tg",
        "options": [
            "Chocolate",
            "Vanilla",
            "Strawberry",
            "Rocky Road",
            "Mint Chocolate Chip",
            "other"
        ],
        "deadline": "2024-04-23T18:26:58.675Z"
    }
    ```

    In the example above, `roster` is the DID of the group created previously. Set `deadline` to a future time.

1. Using that file, create the poll:

    ```sh
    kc create-poll icecream-poll.json --name best-icecream-flavor
    did:test:z3v8AuaWxFtpy6Sp5cpHCBQMrsxdMZVdrYTyXMk62p7n5hs4Tb4
    ```

1. Anyone can now view the poll using the DID or an aliased name (if they create one locally):

    ```console
    $ kc view-poll best-icecream-flavor
    {
        "description": "Which flavor of ice cream is the best?",
        "options": [
            "Chocolate",
            "Vanilla",
            "Strawberry",
            "Rocky Road",
            "Mint Chocolate Chip",
            "other"
        ],
        "deadline": "2024-04-23T18:26:58.675Z",
        "isOwner": true,
        "isEligible": true,
        "voteExpired": false,
        "hasVoted": false,
        "results": {
            "tally": [
                {
                    "vote": 0,
                    "option": "spoil",
                    "count": 0
                },
                {
                    "vote": 1,
                    "option": "Chocolate",
                    "count": 0
                },
                {
                    "vote": 2,
                    "option": "Vanilla",
                    "count": 0
                },
                {
                    "vote": 3,
                    "option": "Strawberry",
                    "count": 0
                },
                {
                    "vote": 4,
                    "option": "Rocky Road",
                    "count": 0
                },
                {
                    "vote": 5,
                    "option": "Mint Chocolate Chip",
                    "count": 0
                },
                {
                    "vote": 6,
                    "option": "other",
                    "count": 0
                }
            ],
            "ballots": [],
            "votes": {
                "eligible": 2,
                "received": 0,
                "pending": 2
            },
            "final": false
        }
    }
    ```

1. Members of the group can cast their vote using `vote-poll`:

    ```sh
    kc vote-poll best-icecream-flavor 5
    did:test:z3v8AuaYFc3SZXkXyYxBxdGb1EuC5hV2BcjfMhemYMg56ztyAJx
    ```

1. Once vote DIDs are collected, the poll controller can add them to the poll results with `update-poll`, using only the vote's (not the voter's) DID:

    ```sh
    kc update-poll did:test:z3v8AuaYFc3SZXkXyYxBxdGb1EuC5hV2BcjfMhemYMg56ztyAJx
    OK
    ```

1. After every eligible ballot has been added, or after the deadline passes, the poll becomes final. The controller can then publish the results with `publish-poll`:

    ```sh
    kc publish-poll best-icecream-flavor
    OK
    ```

    This will publish the results without revealing the ballots. Anyone can [resolve](./04-dids.md#resolving-a-did) the poll's DID to view the results.

1. To make the votes in a poll public use `reveal-poll`:

    ```sh
    kc reveal-poll best-icecream-flavor
    OK
    ```

    Now when anyone resolves the DID of the poll, each ballot will be included.

    > [!WARNING]
    > Once the ballot DIDs are public, the DID which cast that vote is also revealed to the public.
