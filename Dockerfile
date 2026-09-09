FROM node:22-bookworm-slim

ARG GH_VERSION=2.98.0
ARG TARGETARCH=amd64

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client ca-certificates curl \
    && curl -fsSL \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
      -o /tmp/gh.tar.gz \
    && tar -xzf /tmp/gh.tar.gz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" /usr/local/bin/gh \
    && gh version \
    && rm -rf /var/lib/apt/lists/* /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_${TARGETARCH}"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

CMD ["node", "server.js"]
