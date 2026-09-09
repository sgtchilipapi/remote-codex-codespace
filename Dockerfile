FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gh openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

CMD ["node", "server.js"]
