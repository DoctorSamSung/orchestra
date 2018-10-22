import request from 'superagent';
import addProtobuf from 'superagent-protobuf';

import logger from '../common/logger';
import { createTimeoutTask } from '../common/task';
import { imagery } from '../messages';

addProtobuf(request);

export default class SyncBackend {
  /**
   * Backend which pulls data from another imagery service.
   *
   * This is useful for mirroring imagery data on another machine
   * from where the imagery originates from.
   *
   * Telemetry data is simply gathered from the original image.
   */

  /** Create a new sync backend. */
  constructor(imageStore, syncUrl) {
    this._imageStore = imageStore;
    this._syncUrl = syncUrl;
    this._active = false;
  }

  /** Start the sync loop in the background. */
  async start() {
    this._active = true;
    this._runLoop();
  }

  async stop() {
    await this._task.stop();
  }

  async _runLoop() {
    // The last image number we've fetched.
    // Making it into a set allows constant-time lookup.
    let stored = new Set(await this._imageStore.getAvailable());

    this._task = createTimeoutTask(async () => {
      try {
        // First we'll just see what the latest id number is.
        const remoteAvailable = await this._getAvailable();

        // Filter the available images by the ones that our local store
        // currently doesn't have.
        let missing = remoteAvailable.filter(id => !stored.has(id));

        // Getting the images we don't have.
        missing.forEach((id) => {
          logger.debug('Fetching image: ' + id);

          const msg = await this._getImage(id);

          // Getting the image data from the message.
          const image = msg.image;

          // Clearing the image data so only metadata is left.
          msg.image = null;

          // Adding it to the image store.
          await this._imageStore.addImage(image, msg, id);

          stored.add(id);
        });
      } catch (err) {
        const message = err.name + ': ' + err.message;
        logger.error('Encountered an error in sync loop: ' + message);
      }
    }, 250).start();
  }

  /** Get the list of downloadable images from the remote service. */
  async _getAvailable() {
    const { body: msg } =
      await request.get(this._syncUrl + '/api/available')
        .proto(imagery.ImageCount)
        .timeout(5000);

    return msg.count;
  }

  /** Get an image from the sync url by id. */
  async _getImage(id) {
    const { body: image } =
      await request.get(this._syncUrl + '/api/image/' + id)
        .proto(imagery.Image)
        .timeout(5000);

    return image;
  }
}
