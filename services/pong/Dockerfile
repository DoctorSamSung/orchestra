ARG BASE=node:8-alpine

# Compile our js source.
FROM ${BASE} AS builder

WORKDIR /builder

COPY common/nodejs/package.json src/common/
COPY pong/package.json .

RUN npm install

COPY common/messages/stats.proto \
    src/messages/

RUN npm run build-msg

COPY common/nodejs src/common
COPY pong .

RUN npm run build

# Make the actual image now.
FROM ${BASE}

WORKDIR /app

ENV NODE_ENV=production

COPY common/nodejs/package.json src/common/
COPY pong/package.json .

RUN npm install

# Add in the output from the js builder above.
COPY --from=builder /builder/lib lib

COPY /pong/bin bin

ENV PORT=7000 \
    SERVICE_TIMEOUT=5000 \
    PING_SERVICES=''

EXPOSE 7000

CMD FORCE_COLOR=1 npm start --silent
