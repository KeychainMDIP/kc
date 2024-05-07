#!/usr/bin/env sh
git stash
rm -rfv data
git reset --hard
git stash pop
