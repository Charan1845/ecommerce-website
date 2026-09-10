# Container image for DevGear.
#
# Used by Google Cloud Run, Azure Container Apps, Fly.io - anything that takes
# a container. Render can build from this too, though it can also just run the
# Node app directly.

FROM node:24-alpine

# Node's own image already has a non-root "node" user. Running as root inside a
# container is a habit worth not forming.
WORKDIR /app

# Copy the manifests first. Docker caches this layer, so dependencies are only
# reinstalled when package.json actually changes - not on every code edit.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node

# Cloud Run and most hosts hand the port over in $PORT. This is only the
# fallback for running the image locally.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
