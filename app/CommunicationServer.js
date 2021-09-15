'use strict';

const net = require('net');
const {inspect} = require('util');
const chalk = require('chalk');
const Networker = require('./Networker');
const {errorMessage, isObject, isEmpty} = require('./Utils');

const STATE_INITIAL = 0;
const STATE_GAME_STARTED = 1;
const STATE_GAME_ENDED = 2;
const STATE_ALL_LEFT = 3;
const STATE_GM_DISCONNECTED = 4;

//
// NOTES
//

// We extend socket objects with properties:
//   - name - human readable socket name
//   - networker - networker object, should be used for read/write
// We extend server objects with properties:
//   - type - 'agent' or 'gameMaster'
//   - name - human readable listener name

class CommunicationServer {
  /*
   * @param {object} config - Config object compliant with template.
   * @param {object} logger -
   * @param {object} t_agentMsgHandler - Additional agent message handler, used
   * for integration tests
   * @param {object} t_masterMsgHandler - Additional agent message handler, used
   * for integration tests
   */
  constructor(config, logger, t_agentMsgHandler, t_masterMsgHandler) {
    // TODO: Deep copy
    this._config = config;
    this.logger = logger;
    this.agentServer = net.createServer();
    this.agentServer.maxConnections = this._config.maxConnections;
    this.agentServer.type = 'agent';
    this.agentServer.name = 'Agent Server';
    this.agentServer.logger = this.logger.child({name : this.agentServer.name});

    this.masterServer = net.createServer();
    this.masterServer.maxConnections = 1;
    this.masterServer.type = 'gameMaster';
    this.masterServer.name = 'GM Server';
    this.masterServer.logger =
        this.logger.child({name : this.masterServer.name});

    // Client sockets list
    this.clients = {};
    this.master = null;
    // Changes when GM sends gameStarted message
    this.state = STATE_INITIAL;

    // Should be incremented when useds
    this._nextUnusedAgentID = 1;

    this.messagesLookup = {};
    this._createMessagesLookup();

    // clang-format off
    // Bind agent server handlers
    this.agentServer.on('connection', this._agentServerConnectionHandler.bind(this));
    this.agentServer.on('close', (err) => this._serverCloseHandler.call(this, this.agentServer, err));
    this.agentServer.on('error', (err) => this._serverErrorHandler.call(this, this.agentServer, err));

    // Bind master server handlers
    this.masterServer.on('connection',this._masterServerConnectionHandler.bind(this));
    this.masterServer.on('close', (err) => this._serverCloseHandler.call(this, this.masterServer, err));
    this.masterServer.on('error', (err) => this._serverErrorHandler.call(this, this.masterServer, err));
    // clang-format on

    //
    if (t_agentMsgHandler && t_masterMsgHandler) {
      this.t_agentMsgHandler = t_agentMsgHandler;
      this.t_masterMsgHandler = t_masterMsgHandler;
    }
  }

  /*
   * Start servers. Should be called outside of class.
   * @param {function} callback - Called after all servers have started.
   */
  start(callback) {
    this.logger.info(`Trying to start server at`);
    let left = 2;
    left--;

    try {
      this.masterServer.listen(this._config.masterPort, () => {
        // TODO: Log launch time
        this.masterServer.logger.info(
            'Listening', {fullAddress : this.masterServer.address()});
        if (!(--left) && callback) {
          callback();
        }
      });
    } catch (err) {
      this.logger.error(err);
    }

    try {
      this.agentServer.listen(this._config.agentPort, () => {
        // TODO: Log launch time
        this.agentServer.logger.info(
            'Listening', {fullAddress : this.agentServer.address()});
        if (!(--left) && callback) {
          callback();
        }
      });
    } catch (err) {
      this.logger.error(err);
    }
  }

  /*
   * Stops server. Should be called outside of class.
   * @param {function} callback - Called after server has closed.
   */
  stop(callback) {
    // TODO: Add destroying all sockets
    this.logger.info('[server] Closing gracefully...');

    if (this.clients.length > 0) {
      this.logger.info('[server] Disconnecting clients...');
      for (let i in this.clients) {
        this.clients[i].destroy();
      }
    }

    if (this.master !== null) {
      this.logger.info('[server] Disconnecting master...');
      this.master.destroy();
    }

    this.agentServer.close();
    this.masterServer.close();
    if (callback) {
      // Bad wait, but works
      setTimeout(callback, 1000);
    }
  }

  //
  // SERVER HANDLER FUNCTIONS
  //

  /*
   * Handles client connection
   * @param {socket} socket - Freshly connected socket.
   */
  _agentServerConnectionHandler(socket) {
    socket.agentID = this._assignAgentID();

    socket.name =
        `${socket.remoteAddress}, ${socket.remotePort}, AID: ${socket.agentID}`;
    socket.logger = this.logger.child({name : socket.name});
    socket.logger.info('Agent connected');

    // Bind socket handlers
    socket.networker = new Networker(
        socket,
        (data) => this._agentSocketDataHandler(socket, data.toString('utf8')));
    socket.networker.init();

    // Add socket to client list, we could probably generate IDs for them
    this.clients[socket.agentID] = socket;
    this.agentServer.logger.info(`Current agents ${this._getClientNames()}`);

    // TODO: Decide whether to handle close or end
    socket.on('close', () => this._agentSocketCloseHandler(socket));
    socket.on('error', (err) => this._socketErrorHandler(socket, err));
  }

  /*
   * Handles game master connection
   * @param {socket} socket - Freshly connected socket.
   */
  _masterServerConnectionHandler(socket) {
    socket.name = `GM | ${socket.remoteAddress}, ${socket.remotePort}`;
    socket.logger = this.logger.child({name : socket.name});
    socket.logger.info('Game Master connected.');

    socket.networker = new Networker(
        socket,
        (data) => this._masterSocketDataHandler(socket, data.toString('utf8')));
    socket.networker.init();

    this.master = socket;
    this.masterServer.logger.info(`GM connected: ${!!this.master}.`);

    socket.on('close', () => this._masterSocketCloseHandler(socket));
    socket.on('error', (err) => this._socketErrorHandler(socket, err));
  }

  /*
   * On server close.
   * @param {server} server - Listener instance (ie. agentServer, masterServer).
   * @param {error} err - error provided by net library.
   */
  _serverCloseHandler(server, err) {
    if (err) {
      this._serverErrorHandler(server, err);
    }

    server.logger.info('Closed.');
    server.unref();
  }

  /*
   * On agent server error.
   * @param {Object} err - Error object. Can also be a string.
   */
  _serverErrorHandler(server, err) { this.logger.error(err); }

  /*
   * Creates lookup table for messages
   * e.g. code (messageID) -> config key (message 'name')
   */
  _createMessagesLookup() {
    this.logger.info('[server] Creating messages lookup...');

    for (let key in this._config.messages) {
      this.messagesLookup[this._config.messages[key].code] = key;
    }
  }

  /**
   * Converts messageID to message config
   * @param {number} id - messageID.
   */
  _idToMessage(id) { return this._config.messages[this.messagesLookup[id]]; }

  /**
   * Broadcast a message to specified clients
   * @param {object} msg - message object to be broadcasted.
   * @param {array} socketList - List of addressees' socket objects.
   */
  _broadcast(msg, socketList) {
    socketList.forEach(s => {
      if (s !== null)
        s.networker.send(msg);
    });
  };

  /**
   * Returns all connected clients' names.
   */
  _getClientNames() {
    const names = [];
    for (let key in this.clients) {
      names.push(this.clients[key].name);
    }
    return names;
  }

  //
  // AGENT SOCKET HANDLER FUNCTIONS
  //

  /**
   * On data received from agent socket.
   * @param {socket} socket - Handled agent socket.
   * @param {object} data - Freshly received data. Should be UTF8, so it is
   *     automatically parsed to a string.
   */
  _agentSocketDataHandler(socket, data) {
    const message = this._socketDataPreHandler(socket, data, this.agentServer);

    // Message invalid
    if (!message) {
      return;
    }

    // Add agentID (which should be linked to socket)
    message.agentID = socket.agentID;

    // Make sure master is connected
    if (this.master === null) {
      // socket.networker.send(errorMessage({
      //   details : 'Game Master is not connected.',
      // }));
      return;
    }
    socket.logger.debug('Sending to GM...');
    this.master.networker.send(JSON.stringify(message));

    if (this.t_agentMsgHandler) {
      this.t_agentMsgHandler(message, socket.agentID);
    }
  }

  /**
   * On agent socket close.
   * @param {socket} socket - Handled socket.
   */
  _agentSocketCloseHandler(socket) {
    socket.logger.info('Closed.');

    delete this.clients[socket.agentID];

    if (this.state === STATE_GAME_ENDED && isEmpty(this.clients)) {
      // Send message to GM when game has ended and all agents have left
      this.logger.info(chalk.red('GAME_ENDED and all agents left'));
      const message = {
        messageID : this._config.messages.allAgentsLeft.code,
        payload : {},
      };
      this.master.networker.send(JSON.stringify(message));
      this.state = STATE_ALL_LEFT;
    } else {
      const message = {
        messageID : this._config.messages.errorAgentLeft.code,
        agentID : socket.agentID,
        payload : {
          agentID : socket.agentID,
        },
      };
      console.log(message);
      if (this.master !== null)
        this.master.networker.send(JSON.stringify(message));
    }

    this.agentServer.logger.info(`Removed [${socket.name}].`);
    this.agentServer.logger.info(`Current agents: ${this._getClientNames()}`);
  }

  //
  // GAME MASTER SOCKET HANDLER FUNCTIONS
  //

  /**
   * On data received from game master socket.
   * @param {socket} socket - Handled game master socket.
   * @param {object} data - Freshly received data. Should be UTF8, so it is
   *     automatically parsed to a string.
   */
  _masterSocketDataHandler(socket, data) {
    const properties = [ 'agentID' ];
    const message =
        this._socketDataPreHandler(socket, data, this.masterServer, properties);

    if (!message) {
      return;
    }

    // Pop agentID
    const agentID = message.agentID;
    delete message.agentID;

    if (!this.clients[agentID]) {
      socket.networker.send(errorMessage({
        details : 'Agent with given agentID does not exist.',
        agentID : agentID
      }));
      return;
    }

    // Update game state
    if (this.state === STATE_INITIAL) {
      if (message.messageID === this._config.messages.gameStarted.code) {
        this.state = STATE_GAME_STARTED;
        this.masterServer.logger.info('Game started');
      }
    } else if (this.state === STATE_GAME_STARTED) {
      if (message.messageID === this._config.messages.gameEnded.code) {
        this.state = STATE_GAME_ENDED;
        this.masterServer.logger.info('Game ended');
      }
    }
    // Send
    socket.logger.debug(`Sending to AID: ${agentID}...`);
    this.clients[agentID].networker.send(JSON.stringify(message));

    if (this.t_masterMsgHandler) {
      this.t_masterMsgHandler(message, agentID);
    }
  }

  /**
   * On game master close.
   * @param {socket} socket - Handled socket.
   */
  _masterSocketCloseHandler(socket) {
    socket.logger.info('Closed.');

    // Remove master reference
    this.master = null;

    this.masterServer.logger.info(`Removed [${socket.name}]`);
    this.masterServer.logger.info(`GM connected: ${!!this.master}.`);

    if (this.state === STATE_ALL_LEFT) {
      // TODO: Trzeba sprawdzić czy sam wychodzi, bo w testach wychodzi
      this.stop(() => { this.logger.debug('process.exit();'); });
    } else if (this.state !== STATE_INITIAL) {
      const message = {
        messageID : this._config.messages.errorGmLeft.code,
        payload : {},
      };

      this._broadcast(JSON.stringify(message), Object.values(this.clients));
      this.state = STATE_GM_DISCONNECTED;
    }
  }

  //
  // GENERAL SOCKET HANDLER FUNCTIONS
  //

  /**
   * Pre-handle data received from socket.
   * Current behaviour: return false on ivalid message, otherwise return parsed
   * message
   *
   * @param {socket} socket - Handled socket.
   * @param {object} data - Freshly received data. Should be UTF8, so it is
   *     automatically parsed to a string.
   * @param {array} properties - Additional required properties.
   */
  _socketDataPreHandler(socket, data, server, properties) {
    // TODO: Better error logging
    socket.logger.debug('data', inspect(data.toString('utf8')));

    // TODO: The legendary 2 bytes of message length
    const result = assertValidMessage(data, socket, this, server, properties);

    if (!result) {
      // Message not valid
      return false;
    }

    // Message valid
    socket.logger.debug('Valid message', result);
    return result;
  }

  /**
   * On socket error.
   * @param {socket} socket - Handled socket.
   * @param {object} err - Error thrown by socket.
   */
  _socketErrorHandler(socket, err) { socket.logger.error(err); }

  _assignAgentID() { return this._nextUnusedAgentID++; }
}

//
// MESSAGE VALIDATORS
// assert* - if check fails, throw error
//

/**
 * If message is invalid, logs and sends back an error message.
 * @param {object} msg - Should be raw.
 * @param {socket} socket - Caller socket object.
 * @param {CommunicationServer} commServer - CommunicationServer instance.
 * @param {server} server - Listener instance (ie. agentServer, masterServer).
 * @param {array} properties - Additional required properties.
 */
function assertValidMessage(msg, socket, commServer, server, properties) {
  // TODO: DRY code

  // Try to parse JSON request
  let parsed;
  try {
    parsed = JSON.parse(msg);
  } catch (err) {
    const error = {details : 'Invalid JSON.'};
    commServer._serverErrorHandler(server, error);
    socket.networker.send(errorMessage(error));
    return false;
  }

  // Check against adapter template
  try {
    // Copy default required properties and expand if given additional
    let requiredProperties = [...commServer._config.messageRequiredProperties ];
    if (properties) {
      requiredProperties = requiredProperties.concat(properties);
    }
    assertProperties(parsed, requiredProperties);
  } catch (err) {
    commServer._serverErrorHandler(server, err);
    socket.networker.send(errorMessage(err));
    return false;
  }

  // Check messageID
  try {
    assertProperMessageID(parsed, commServer.messagesLookup);
  } catch (err) {
    commServer._serverErrorHandler(server, err);
    socket.networker.send(errorMessage(err));
    return false;
  }

  const msgConfig = commServer._idToMessage(parsed.messageID);

  // Assert appropriate message type (i.e. agent or gameMaster)
  try {
    assertProperMessageType(parsed, msgConfig, server);
  } catch (err) {
    commServer._serverErrorHandler(server, err);
    socket.networker.send(errorMessage(err));
    return false;
  }

  // Assert payload, if necessary
  try {
    assertPayload(parsed, msgConfig);
  } catch (err) {
    commServer._serverErrorHandler(server, err);
    socket.networker.send(errorMessage(err));
    return false;
  }

  // Message valid
  return parsed;
}

/**
 * Checks if object has all given properties (keys)
 * @param {object} obj - Object to be checked for properties.
 * @param {array} checklist - List of properties as strings.
 */
function assertProperties(obj, checklist) {
  const missing = [];
  for (let i in checklist) {
    if (!obj.hasOwnProperty(checklist[i])) {
      missing.push(checklist[i]);
    }
  }

  if (missing.length > 0) {
    throw {details : 'Missing properties.', missingProperites : missing};
  }

  return true;
}

/**
 * Checks if message has an ID defined in config
 * @param {object} msg - Should be already parsed from JSON.
 * @param {object} lookup - Lookup generated by CommunicationServer.
 */
function assertProperMessageID(msg, lookup) {
  if (!lookup.hasOwnProperty(msg.messageID)) {
    throw {details : 'Invalid messageID.', messageID : msg.messageID};
  }
}

/**
 * Checks if message requires payload, if so, checks if message has payload
 * @param {object} msg - Should be already parsed from JSON.
 * @param {object} msgConfig - Message options from config file.
 */
function assertPayload(msg, msgConfig) {
  if (msgConfig.payloadRequired) {
    if (!msg.hasOwnProperty('payload')) {
      throw {
        details : 'Missing properties.',
        missingProperites : [ 'payload' ]
      };
    }
    if (!isObject(msg.payload)) {
      throw {details : 'Payload should be an object.'};
    }
  }
}

/**
 * Checks if message type is permitted for given server.
 * @param {object} msg - Should be already parsed from JSON.
 * @param {object} msgConfig - Message options from config file.
 * @param {server} server - Listener instance (ie. agentServer, masterServer).
 */
function assertProperMessageType(msg, msgConfig, server) {
  if (msgConfig.type !== server.type) {
    throw {
      details : 'This message is not permitted with your connection.',
      permittedConnectionType : msgConfig.type
    };
  }
}

function assertWrapper(callback) {}

// Export only `CommunicationServer` and states
exports.CommunicationServer = CommunicationServer;
exports.States = {
  INITIAL : STATE_INITIAL,
  GAME_STARTED : STATE_GAME_STARTED,
  GAME_ENDED : STATE_GAME_ENDED,
  GM_DISCONNECTED : STATE_GM_DISCONNECTED,
};
