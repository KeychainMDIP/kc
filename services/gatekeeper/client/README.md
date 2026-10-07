# MDIP Gatekeeper WebUI Wallet

This directory contains the MDIP Gatekeeper WebUI wallet app. This is a minimalistic reference implementation wallet that can be used as-is or as a basis for future MDIP wallet development efforts.

## Accessing your Gatekeeper Web Wallet

A public MDIP web wallet exposed by the Gatekeeper process [http://localhost:4224/](http://localhost:4224).

The Gatekeeper's Web Wallet on port 4224 stores its seed and keys on the visiting user's device. The server itself has no visibility to the user's keys.

## Build configuration

Vite embeds these settings when the web client is built:

| variable | default | description |
| --- | --- | --- |
| `VITE_GATEKEEPER_DID_PREFIX` | did:test | DID prefix used when creating identifiers |
| `VITE_SEARCH_PORT` | 4002 | Search Server port on the browser's current hostname |

Docker Compose derives these values from `KC_GATEKEEPER_DID_PREFIX` and
`KC_SEARCH_SERVER_PORT` when it builds the Gatekeeper image.
