# MDIP Keymaster WebUI Wallet

This directory contains the MDIP Keymaster WebUI wallet app. This is a minimalistic reference implementation wallet that can be used as-is or as a basis for future MDIP wallet development efforts.

![MDIP Keymaster WebUI Client](https://github.com/user-attachments/assets/d8b5ad9a-0183-4c42-8bbf-1040eb794c5f)

## Accessing your Keymaster Web Wallet

A standard MDIP deployment will operate 2 instances of the Keymaster Web Wallet: 
1. A public MDIP web wallet exposed by the Gatekeeper process [http://localhost:4224/](http://localhost:4224)
2. A **private** MDIP web wallet exposed by the server's Keymaster process on port [http://localhost:4226/](http://localhost:4226)

The Gatekeeper's Web Wallet on port 4224 stores its seed and keys on the visiting user's device. The server itself has no visibility to the user's keys.

The Keymaster's Web Wallet on port 4226 exposes the server keys located in the kc/data/wallet.json directory. This shares the same wallet as accessed by the ./kc command line interface client. **Port 4226 should never be exposed to the public as it exposes the server's keymaster wallet.**
