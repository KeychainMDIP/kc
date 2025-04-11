# cli tests

This is a start of the CLI testing suite for the MDIP Protocol. More tests will be added here. But to get started, these tests are based on Expect/TCL. These tests should be ran only on nodes that do not have any mediators. This will ensure nothing is written. 

## Quick start

Dependencies:
- MacOSX or Linux machine
- Capable of running the nodes locally with docker
- Framework can be installed for MacOSx using Homebrew: https://formulae.brew.sh/formula/expect
- When starting nodes, use the following command: "./start-node cli"
- Before running tests, the tests expect the cli commands are accessible by running the "kc" or "admin" command globally.This can be done by adding them to your PATH.
- Then from /tests, run "./run_cli_tests.sh"

* When running without hyperswarm you should set KC_DEFAULT_REGISTRY=local in the .env, otherwise create operations will fail.
* Tests at this time run only for "local" registry, but will be updated later for others.
* Tests automatically clean up any artifacts it generates in folder and docker. This is done by resetting the wallet when the test is sucessful. If tests, fail data is not deleted so you can debug and inspect. 
