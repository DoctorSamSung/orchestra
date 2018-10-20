ARG BASE=node:8-alpine

# Compile our js source.
FROM ${BASE} AS builder

WORKDIR /builder

# We need packages to install the gphoto2 node dependency.
RUN apk --no-cache add \
    make \
    g++ \
    git \
    python-dev \
    libgphoto2-dev

COPY common/nodejs/package.json src/common/
COPY imagery/package.json .

RUN npm install

COPY common/messages/imagery.proto \
    common/messages/stats.proto \
    common/messages/telemetry.proto \
    src/messages/

RUN npm run build-msg

COPY common/nodejs src/common
COPY imagery .

RUN npm run build

# Make the actual image now.
FROM ${BASE}

WORKDIR /app

ENV NODE_ENV=production

# We need both libgphoto2 and graphicsmagick at runtime.
RUN apk --no-cache add \
    libgphoto2-dev \
    graphicsmagick

# Copying over gphoto2 since we don't have to build it again.
COPY --from=builder /builder/node_modules/gphoto2 node_modules/gphoto2

COPY common/nodejs/package.json src/common/
COPY imagery/package.json .

RUN npm install

# Add in the output from the js builder above.
COPY --from=builder /builder/lib lib

COPY /imagery/bin bin

ENV PORT=8081 \
    # Must be one of "gphoto2", "file", "sync".
    BACKEND='gphoto2' \
    # Must be set if using the sync backend.
    IMAGERY_SYNC_HOST='' \
    IMAGERY_SYNC_PORT='8081' \
    # Can be set when using the gphoto2 backend.
    TELEMETRY_HOST='telemetry' \
    TELEMETRY_HOST='5000' \
    # Interval to trigger gphoto2 images at in the gphoto2 backend.
    # Defaults to 2 seconds.
    CAPTURE_INTERVAL='2' \
    # Maximum number of images that can be stored at a time in the
    # store. Old images will be pruned after the limit is reached.
    # Set this to 0 to disable.
    MAX_IMAGES='200'

EXPOSE 8081

CMD FORCE_COLOR=1 npm start --silent
