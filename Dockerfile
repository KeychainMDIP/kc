# Use the official Node.js as the base image
FROM node:18.15.0

ARG KC_NODE_ID=jeremy-netki-local
ARG KC_GATEKEEPER_URL=https://mdip.yourself.dev
ARG KC_UID=501
ARG KC_GID=20

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json .
COPY packages/ ./packages/

RUN echo "\
KC_NODE_ID=$KC_NODE_ID \n\
KC_GATEKEEPER_URL=$KC_GATEKEEPER_URL \n\
KC_UID=$KC_UID \n\
KC_GID=$KC_GID \n\
" > .env

RUN ls -alsh
RUN cat .env

# Install dependencies
RUN npm ci

COPY services/keymaster ./keymaster/

RUN cd keymaster/client && npm ci && npm run build
RUN cd keymaster/server && npm ci

WORKDIR /app/keymaster

# Run...
CMD ["node", "server/src/keymaster-api.js"]
