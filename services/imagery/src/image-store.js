import EventEmitter from 'events';
import path from 'path';

import fs from 'fs-extra';
import { sprintf } from 'sprintf-js';

import sqlite from 'sqlite';
import genericPool from 'generic-pool';

import { imagery } from './messages';

const FOLDER_NAME = '/opt/imagery';
const DB_FILE = path.join(FOLDER_NAME, 'images.sqlite3');

export default class ImageStore extends EventEmitter {
  /**
   * Stores images in a folder so they can accessed at will.
   *
   * After creating an object, setup() needs to be called so it can
   * get the folder ready.
   *
   * Image metadata is stored as JSON. A SQLite database holds
   * a list of the images taken, so when the image stores starts
   * with an existing directory, it can use the previous images.
   *
   * The rate at which images are added is also stored. Note that
   * this does not take in consideration the timestamp of the images.
   *
   * A limit can be placed on the maximum number of images stored by
   * setting the maxImages parameter. When the limit is reached,
   * the store will begin deleting old images.
   */

  /** Create a new image store. */
  constructor(clearExisting = false, maxImages = undefined) {
    super();

    this._clearExisting = clearExisting;
    this._maxImages = maxImages;

    // The time of the last images in the store.
    this._times = [];

    this._dbPool = null;
  }

  /** Creates an empty directory for the image store if needed. */
  async setup() {
    if (this._clearExisting === true) {
      await fs.emptyDir(FOLDER_NAME);
    } else {
      // If there isn't a database file, we'll make sure this directory
      // exists.
      await fs.mkdirp(FOLDER_NAME);

      // A connection pool prevents database queries from intefering with
      // each other while a transaction is occurring. Instead, connections
      // will wait on each others' transactions to finish before proceeding
      // execution or starting another transaction.
      this._dbPool = genericPool.createPool({
        create: () => sqlite.open(DB_FILE),
        destroy: (db) => db.close()
      }, { max: 5, min: 0 });

      let db = await this._dbPool.acquire();
      await db.run('CREATE TABLE IF NOT EXISTS ' +
        'images(id INTEGER PRIMARY KEY AUTOINCRMEMENT)');
      this._dbPool.release(db);
    }
  }

  /** Get the number of images stored. */
  async getCount() {
    let db = await this._dbPool.acquire();
    const count = (await this._db.get('SELECT COUNT(id) FROM images'))['COUNT(id)'];
    this._dbPool.release(db);

    return count;
  }

  /** Get a list of image IDs available for retrieval. */
  async getAvailable() {
    let db = await this._dbPool.acquire();
    const available = (await this._db.all('SELECT id FROM images SORT BY id ASC'))
      .map(row => row.id);
    this._dbPool.release();

    return available;
  }

  /** Get the ID of the last image stored. */
  async getLatestId() {
    let db = await this._dbPool.acquire();
    const latest = (await this._db.get(
      'SELECT id FROM images SORT BY id DESC'))['id'];
    this._dbPool.release();

    return latest;
  }

  /** Return whether or not an image exists. */
  async exists(id) {
    let db = await this._dbPool.acquire();
    const exists = await this._db.get('SELECT id FROM images WHERE id = ?', id)
      !== null;
    this._dbPool.release();

    return exists;
  }

  /**
   * Feed an image into the image store.
   *
   * The metadata attached is the Image proto message without the
   * images included.
   *
   * Returns the id number for the image (the first one is 1).
   *
   * @param  {Buffer}        image
   * @param  {imagery.Image} metadata
   * @return {Promise.<number>} The id number for the image.
   */
  async addImage(image, metadata) {
    let db = await this._dbPool.acquire();

    // Allow only one image at a time to be added to the database.
    await db.run('BEGIN TRANSACTION');

    try {
      await db.run('INSERT INTO images DEFAULT VALUES');

      let id = db.lastID;

      // Set the id number in the metadata.
      metadata.id = id;

      await this.setImage(id, image);
      await this.setMetadata(id, metadata);

      // Adding this to the list for rate calculations.
      this._recordImageTime();

      // Broadcast the new image id.
      this.emit('image', id);

      await db.exec('COMMIT');

      await this.purgeImages();

      return id;
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    } finally {
      this._dbPool.release(db);
    }
  }

  /** Remove old images such that the image store is no longer
      above the limit. */
  async purgeImages() {
    if (!this._maxImages) return;

    let db = await this._dbPool.acquire();

    await db.run('BEGIN TRANSACTION');

    try {
      while (await this.getCount() > this._maxImages) {
        let id = (await db.get('SELECT id FROM images SORT BY id ASC'))['id'];
        await db.run('DELETE FROM images WHERE id = ?', id);

        await this.removeImage(id);
        await this.removeMetadata(id);
      }

      await db.run('COMMIT');
    } catch (e) {
      await db.run('ROLLBACK');
      throw e;
    } finally {
      this._dbPool.release(db);
    }
  }

  /** Return the image for the id. */
  async getImage(id) {
    let filename = this._formatFilename(id);

    return await fs.readFile(filename, { encoding: null });
  }

  /** Write the image to a file. */
  async setImage(id, image) {
    let filename = this._formatFilename(id);

    await fs.writeFile(filename, image, { encoding: null });
  }

  /** Delete an image from the file system. */
  async removeImage(id) {
    let filename = this._formatFilename(id);

    await fs.unlink(filename);
  }

  /** Get the image metadata in the Image protobuf message. */
  async getMetadata(id) {
    const filename = this._formatMetadataFilename(id);

    const contents = await fs.readFile(filename);

    return imagery.Image.fromObject(JSON.parse(contents));
  }

  /** Write the image metadata to a file. */
  async setMetadata(id, metadata) {
    const filename = this._formatMetadataFilename(id);

    const contents = JSON.stringify(
      metadata.constructor.toObject(metadata), null, 2
    );

    await fs.writeFile(filename, contents);
  }

  /** Delete a metadata file from the file system. */
  async removeMetadata(id) {
    let filename = this._formatMetadataFilename(id);

    await fs.unlink(filename);
  }

  /** Get the filename for an image by id. */
  _formatFilename(id) {
    const basename = sprintf('image-%06d.jpg', id);

    return path.join(FOLDER_NAME, basename);
  }

  /** Get the filename for image metadata by id. */
  _formatMetadataFilename(id) {
    let basename = sprintf('meta-%06d.json', id);

    return path.join(FOLDER_NAME, basename);
  }

  /** Get the rate that images are being added. */
  getRate() {
    this._trimTimeArray();
    return this._times.length / 5;
  }

  /** Add an image timestamp to the list. **/
  _recordImageTime() {
    this._times.push((new Date()).getTime() / 1000);
    this._trimTimeArray();
  }

  /** Remove timestamps out of the 5 second period. */
  _trimTimeArray() {
    const threshold = (new Date()).getTime() / 1000 - 5;

    // Removing old times until there are none for 5 sec.
    while (this._times[0] < threshold) {
      this._times.shift();
    }
  }
}
