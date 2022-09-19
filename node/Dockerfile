FROM node:16

# Install dapr CLI
RUN wget -q https://raw.githubusercontent.com/dapr/cli/master/install/install.sh -O - | /bin/bash

# Install daprd
ARG DAPR_BUILD_DIR
COPY $DAPR_BUILD_DIR /opt/dapr
ENV PATH="/opt/dapr/:${PATH}"
ENV NODE_OPTIONS="--max-old-space-size=51200"
RUN dapr init --slim

RUN curl -f https://get.pnpm.io/v6.16.js | node - add --global pnpm

WORKDIR /app

# pnpm fetch does require only lockfile
COPY pnpm-lock.yaml ./
COPY .npmrc ./

RUN pnpm fetch --prod


COPY . /app
RUN pnpm install -r --prod

CMD [ "pnpm", "-r" ,"run","check"]