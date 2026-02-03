# DID Explorer

A React-based DID (Decentralized Identifier) explorer designed for viewing and interacting with DIDs and DID Documents on Bitcoin, Feathercoin, and Hyperswarm networks. This explorer is developed using Vite with native TypeScript support.

## Project Setup

### Prerequisites

- Node.js (>=18.x recommended)

### Installation

From the `services/explorer` directory, install dependencies:

```bash
npm install
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

# URL where your Gatekeeper service is running
VITE_GATEKEEPER_URL=http://localhost:4224

# Logging for the explorer server
KC_LOG_LEVEL=info
```

### Running the Explorer

Start the explorer in development mode:

```bash
npm start
```

This will start the React app locally. Open your browser to view the explorer:

```
http://localhost:<VITE_EXPLORER_PORT>
```

(Replace `<VITE_EXPLORER_PORT>` with the port number you specified in `.env`)

## Building for Production

To create a production build, run:

```bash
npm run build
```

## Contributing

Feel free to open issues or submit pull requests for improvements and new features.

