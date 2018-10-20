import Koa from 'koa';

import koaLogger from './common/koa-logger';
import logger from './common/logger';

import GPhoto2Backend from './backends/gphoto2-backend';
import FileBackend from './backends/file-backend';
import SyncBackend from './backends/sync-backend';
import ImageStore from './image-store';
import router from './router';

/**
 * Service-level implementation for imagery.
 *
 * An API is hosted which serves imagery data. Tasks are created for
 * either taking photos, watching a folder, or syncing imagery with
 * another imagery service.
 */
export default class Service {
  /**
   * Create a new imagery service.
   *
   * @param {Object} options
   * @param {number} options.port
   * @param {string} options.backend - one of 'gphoto2', 'file',
   *                                    'sync'
   * @param {string} [options.imagerySyncHost]
   * @param {string} [options.imagerySyncPort]
   * @param {string} [options.telemetryHost]
   * @param {string} [options.telemetryPort]
   * @param {number} [options.captureInterval]
   */
  constructor(options) {
    if (['gphoto2', 'file', 'sync'].indexOf(options.backend) === -1)
      throw Error('Invalid backend type');
    if (options.backend == 'sync' && !options.imagerySyncHost)
      throw Error('Imagery sync host is required with sync backend');
    if (options.backend == 'sync' && !options.imagerySyncPort)
      throw Error('Imagery sync port is required with sync backend');

    this._port = options.port;
    this._backendType = options.backend;

    this._imagerySyncUrl = 'http://' + options.imagerySyncHost + ':' +
        options.imagerySyncPort;
    this._telemetryUrl = options.telemetryHost && options.telemetryPort &&
        'http://' + options.telemetryHost + ':' + options.telemetryPort;
    this._captureInterval = options.captureInterval;

    this._maxImages = options.maxImages;
  }

  /** Start the service. */
  async start() {
    logger.debug('Starting service.');

    this._imageStore = new ImageStore(maxImages = this._maxImages);
    await this._imageStore.setup();

    this._imageStore.on('image', id => logger.debug(`Added image ${id}.`));

    // Create the backend requested.
    switch (this._backendType) {
    case 'gphoto2':
      this._backend = new GPhoto2Backend(
        this._imageStore, this._captureInterval, this._telemetryUrl
      );
      break;
    case 'file':
      this._backend = new FileBackend(this._imageStore);
      break;
    case 'sync':
      this._backend = new SyncBackend(this._imageStore, this._imagerySyncUrl);
    }

    // Start up the backend.
    await this._backend.start();

    this._server = await this._createApi(this._imageStore);

    logger.debug('Service started.');
  }

  /** Stop the service. */
  async stop() {
    logger.debug('Stopping service.');

    await this._backend.stop();
    await this._server.closeAsync();

    this._server = null;

    logger.debug('Service stopped.');
  }

  // Create the koa api and return the http server.
  async _createApi(imageStore) {
    let app = new Koa();

    // Make the image store available to the routes.
    app.context.imageStore = imageStore;

    app.use(koaLogger());

    // Set up the router middleware.
    app.use(router.routes());
    app.use(router.allowedMethods());

    // Start and wait until the server is up and then return it.
    return await new Promise((resolve, reject) => {
      let server = app.listen(this._port, (err) => {
        if (err) reject(err);
        else resolve(server);
      });

      // Add a promisified close method to the server.
      server.closeAsync = () => new Promise((resolve) => {
        server.close(() => resolve());
      });
    });
  }
}
