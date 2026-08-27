# DID Explorer

A React-based DID (Decentralized Identifier) explorer for viewing DIDs, DID documents, and operations from configured MDIP registries. It uses Vite with TypeScript.

## Project Setup

### Prerequisites

- Node.js 22.15.0 and npm 10.8.2 or newer

### Installation

The Explorer server uses built workspace packages. Install and build the workspace from the repository root before installing Explorer's standalone dependencies:

```bash
npm ci
npm run build
cd services/explorer
npm ci
```

### Configuration

Copy the provided environment sample and configure the necessary variables:

```bash
cp sample.env .env
```

Then edit the `.env` file to set your desired configuration:

```env
# The port your explorer will run on
VITE_EXPLORER_PORT=4000

# URL where your search server is running
VITE_SEARCH_SERVER=http://localhost:4002

# Registry names shown in operation network filters
VITE_OPERATION_NETWORKS=hyperswarm,TFTC,TBTC

# Logging for the explorer server
KC_LOG_LEVEL=info
```

### Running the Explorer

Start the explorer in development mode:

```bash
npm run dev
```

This will start the React app locally. Open your browser to view the explorer:

```
http://localhost:<VITE_EXPLORER_PORT>
```

(Replace `<VITE_EXPLORER_PORT>` with the port number you specified in `.env`)

## Building for Production

To build and run the production server, run:

```bash
npm start
```
