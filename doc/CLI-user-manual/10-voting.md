---
title: Voting
---

The MDIP protocol allows for near-endless forms of communication. This page covers the "group" and "poll" set of commands provided by the `kc` CLI tool, which demonstrate how MDIP can be used to perform secure voting.

In the examples below, we'll create a poll to decide the best flavor of ice cream.

## Voting Groups

Groups are simply collections of identity DIDs that are allowed to cast votes in a poll.

1. Create a new group:

    ```sh
    kc group-create icecream-tasters
    did:mdip:klf75KJH6LKlh654LP4C7hexSVfDhFcSiZr8xfS1tg
    ```

1. Add members to the polling group using their DID:

    ```sh
    kc group-add icecream-tasters did:mdip:z3v8AuzzXKfwrt4Y3AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwjm8
    {
      members: [
        'did:mdip:z3v8AuzzXKfwrt4Y3AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwjm8'
      ],
      name: 'icecream-tasters'
    }
    ```

   Members can also be added using their [aliased names](./08-aliased-names.md):

    ```sh
    kc group-add icecream-tasters alice
    {
      members: [
        'did:mdip:z3v8AuzzXKfwrt4Y3AAbDaGqLNgyn1BDhP7wUFpEMEngmwYwjm8',
        'did:mdip:z3v8AuaZ6U4FwcfLA82aGf6n8qpwRtkKCStRMokvU4gSwHHHrzC'
      ],
      name: 'icecream-tasters'
    }
    ```

    If a member should be removed from a group, use `kc group-remove` with their DID or aliased name.

1. You can check to see if a DID is part of the group:

    ```sh
    kc group-test icecream-tasters bob
    false
    ```


## Polls

Polls are DID objects that follow a provided template to provide options, and collect and summarize votes.

1. Create a JSON file to define the poll using the `poll-template` command:

    ```sh
    kc poll-template > icecream-poll.json
    ```

1. Edit the poll file:

    ```json title="icecream-poll.json"
    {
        "type": "poll",
        "version": 1,
        "description": "Which flavor of ice cream is the best?",
        "roster": "did:mdip:klf75KJH6LKlh654LP4C7hexSVfDhFcSiZr8xfS1tg",
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

    In the example above, the value of `roster` matches the DID of the group we created previously.

1. Using that file, create the poll:

    ```sh
    kc poll-create icream-poll.json best-icecream-flavor
    ```

1. Anyone can now view the poll using the DID or an aliased name (if they create one locally):

    ```json
    kc poll-view best-icecream-flavor
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

1. Members of the group can cast their vote using `poll-vote`:

    ```sh
    kc poll-vote best-icecream-flavor 5
    did:mdip:z3v8AuaYFc3SZXkXyYxBxdGb1EuC5hV2BcjfMhemYMg56ztyAJx
    ```

1. Once vote DIDs are collected, the poll controller can add them to the poll results with `poll-update`, using only the vote's (not the voter's) DID:

    ```sh
    kc poll-update did:mdip:z3v8AuaYFc3SZXkXyYxBxdGb1EuC5hV2BcjfMhemYMg56ztyAJx
    OK
    ```

1. The controller of the poll can publish the results with `poll-publish`:

    ```sh
    kc poll-publish best-icecream-flavor
    OK
    ```

    This will publish the results without revealing the ballots. Anyone can [resolve](./04-dids.md#resolving-a-did) the poll's DID to view the results.

1. To make the votes in a poll public use `poll-reveal`:

    ```sh
    kc poll-reveal best-icecream-flavor
    OK
    ```

    Now when anyone resolves the DID of the poll, each ballot will be included.

    > [!WARNING]
    > Once the ballot DIDs are public, the DID which cast that vote is also revealed to the public.
