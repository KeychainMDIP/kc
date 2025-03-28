# cli tests

This is a start of the CLI testing suite for the MDIP Protocol. More tests will be added here. But to get started, these tests are based on Expect/TCL. These tests should be ran only on nodes that do not have any mediators. This will ensure nothing is written. 

## Quick start

Dependencies:
- MacOSX or Linux machine
- Capable of running the nodes locally with docker
- Framework can be installed for MacOsx using Homebrew: https://formulae.brew.sh/formula/expect
- When starting nodes, use the following command: "./start-node cli"
- Before running tests, the tests expect the cli is accessible by running the "kc" command.
- Then from /tests/cli-tests, run "expect {name of file or test} ex. "expect test_cli_check_list_ids.expect"

* When running without hyperswarm you should set KC_DEFAULT_REGISTRY=local in the .env, otherwise create operations will fail.
