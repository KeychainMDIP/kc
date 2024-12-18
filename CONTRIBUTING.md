# Contributing to the MDIP Keychain open source project

1. [Create an issue](https://github.com/KeychainMDIP/kc/issues) first
    - Requirements and acceptance criteria should be discussed in the issue
2. Create a development branch from the issue
    - Branch name should start with issue number
    - Github provides a link in the issue to [create the branch](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-a-branch-for-an-issue)
3. Create a PR from the development branch
    - All PRs must be linked to an issue
4. If the PR contains code changes then do a smoke test before merge
    - Use `./start-node` to build and run the containers
    - Make sure the node syncs OK
    - Check the service logs for any errors
    - An easy check is to run `./kc perf-test` (to create 100 local ephemeral credentials) followed by `./admin verify-db` (to garbage-collect the test credentials)
5. Merge the PR with squashed commits
6. Use [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) prefixes for the merge commit message
