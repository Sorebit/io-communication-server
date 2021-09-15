// Adapted from:
// https://medium.com/@nikolaystoykov/build-custom-protocol-on-top-of-tcp-with-node-js-part-1-fda507d5a262

'use strict';

const STATE_HEADER = 'HEADER'
const STATE_PAYLOAD = 'PAYLOAD'

class Networker {
  /*
   * @param {socket} socket -#
   * @param {function} handler - will be called when a complete message is read.
   */
  constructor(socket, handler) {
    this.socket = socket;
    this._packet = {};

    this._process = false;
    this._state = STATE_HEADER;
    this._payloadLength = 0;
    this._bufferedBytes = 0;
    this.queue = []; // queue of Buffers

    this.handler = handler;
  }

  /*
   * Binds event handlers. Should be called immediately after creating a
   * networker instance.
   */
  init() {
    this.socket.on('data', (data) => {
      this._bufferedBytes += data.length;
      this.queue.push(data);

      this._process = true;
      this._onData();
    });

    this.socket.on('served', this.handler);
  }

  /*
   * Checks if there are enough buffered bytes.
   * If there are not, it stops processing.
   * @param {number} size - number of bytes.
   */
  _hasEnough(size) {
    if (this._bufferedBytes >= size) {
      return true;
    }
    this._process = false;
    return false;
  }

  /*
   * Reads bytes from buffer. Possibilty of reading should be checked first.
   * @param {integer} size - number of bytes to be read.
   */
  _readBytes(size) {
    let result;
    this._bufferedBytes -= size;

    // If queue element is exactly that long
    if (size === this.queue[0].length) {
      return this.queue.shift();
    }

    // If queue element is longer than given size
    if (size < this.queue[0].length) {
      result = this.queue[0].slice(0, size);
      this.queue[0] = this.queue[0].slice(size);
      return result;
    }

    // Otherwise, read from multiple consecutive queue elements
    result = Buffer.allocUnsafe(size);
    let offset = 0;
    let length;

    while (size > 0) {
      length = this.queue[0].length;

      if (size >= length) {
        this.queue[0].copy(result, offset);
        offset += length;
        this.queue.shift();
      } else {
        this.queue[0].copy(result, offset, 0, size);
        this.queue[0] = this.queue[0].slice(size);
      }

      size -= length;
    }

    return result;
  }

  /*
   * Tries to read 2 bytes of payload length. If successful, changes state to
   * process payload.
   */
  _getHeader() {
    if (this._hasEnough(2)) {
      this._payloadLength = this._readBytes(2).readUInt16LE(0, true);
      this._state = STATE_PAYLOAD;
    }
  }

  /*
   * Tries to read whole payload. If successfull, emits event end changes state
   * back for next header processing.
   */
  _getPayload() {
    if (this._hasEnough(this._payloadLength)) {
      let received = this._readBytes(this._payloadLength);
      this.socket.emit('served', received);
      this._state = STATE_HEADER;
    }
  }

  /*
   * Socket 'data' event handler. Tries to process as many messages as possible.
   */
  _onData(data) {
    while (this._process) {
      switch (this._state) {
      case STATE_HEADER:
        this._getHeader();
        break;
      case STATE_PAYLOAD:
        this._getPayload();
        break;
      }
    }
  }

  /*
   * Creates packet for given message, then sends it.
   * @param {string} message
   */
  send(message) {
    let buffer = Buffer.from(message);
    this._header(buffer.length);
    this._packet.message = buffer;
    this._send();
  }

  /*
   * Sets header based on message length.
   * @param {integer} messageLength
   */
  _header(messageLength) { this._packet.header = {length : messageLength}; }

  /*
   * Sends current packet stored in _packet.
   * First sends 2 bytes of header, then the payload itself.
   */
  _send() {
    let contentLength = Buffer.allocUnsafe(2);
    contentLength.writeUInt16LE(this._packet.header.length);
    // console.log('Attempting to write...', this._packet);
    try {
      this.socket.write(contentLength);
      this.socket.write(this._packet.message);
    } catch (err) {
      console.log("Heeeeeeeeeeee", err);
    }
    this._packet = {};
  }
}

module.exports = Networker;
