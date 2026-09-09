FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gh openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /root/.ssh \
    && ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

CMD ["node", "server.js"]