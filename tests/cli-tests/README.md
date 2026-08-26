# cli tests

This is the start of the CLI testing suite for the MDIP Protocol. These tests use Expect/Tcl and should run only on nodes without mediators so operations are not distributed to external networks.

## Quick start

Dependencies:

- macOS or Linux machine
- Capable of running the nodes locally with Docker
- Expect can be installed on macOS using Homebrew: https://formulae.brew.sh/formula/expect
- When starting nodes, use the following command: "./start-node cli"
- Before running tests, make the `kc` and `admin` commands globally accessible by adding them to your `PATH`.
- Then from /tests, run "./run_cli_tests.sh --local"

* Set `KC_DEFAULT_REGISTRY=local` and `KC_GATEKEEPER_REGISTRIES=local` in `.env`. Otherwise, local create operations will fail.
* Tests run only against the `local` registry.
* Tests automatically clean up the artifacts they generate by resetting the wallet after a successful run. If tests fail, data is retained for debugging.
