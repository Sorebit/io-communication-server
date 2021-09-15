'use strict';

const assert = require('assert');
const net = require('net');
const chalk = require('chalk');
const winston = require('winston');

const {CommunicationServer, States} = require('../app/CommunicationServer');
const Networker = require('../app/Networker');
const config = require('../config.json');

const logger = winston.createLogger(
    {level : 'warning', transports : [ new winston.transports.Console() ]});

describe('CommunicationServer', () => {
  const communicationServer = new CommunicationServer(config, logger);
  let client = null;
  let master = null;
  let agentID = 0;

  before((done) => { communicationServer.start(done); });

  describe('on connection', () => {
    it('accepts client connection', (done) => {
      const connectionsBefore = Object.keys(communicationServer.clients).length;

      client = net.connect({port : config.agentPort}, () => {
        client.networker = new Networker(client, (data) => {});
        client.networker.init();

        // Client count should be increased by 1
        const connectionsAfter =
            Object.keys(communicationServer.clients).length;
        assert.equal(connectionsBefore + 1, connectionsAfter);
        done();
      });
    });

    it('assigns agent ID', () => {
      const agentIDs = Object.keys(communicationServer.clients);
      agentID = agentIDs[0];
      assert.notEqual(agentID, 0);
    });
  });

  describe('on valid agent message with no master', () => {
    // it('send back missing game master error', (done) => {
    it('ignores message', (done) => {
      const validMessage = {
        messageID : 1,
        //timeSent : '2020-03-20T19:24:10.255Z'
      };
      // const expResp = {error : {details : 'Game Master is not connected.'}};

      assert.doesNotThrow(
          () => { client.networker.send(JSON.stringify(validMessage)); },
          TypeError);
      done();

      // sendReceiveHelper(client, validMessage, expResp, done); // TODO
    });
  });

  describe('on game master connection', () => {
    it('accepts game master connection', (done) => {
      const connectionsBefore = communicationServer.clients.length;

      master = net.connect({port : config.masterPort}, () => {
        master.networker = new Networker(master, (data) => {});
        master.networker.init();

        assert.notEqual(communicationServer.master, null);
        done();
      });
    });
  });

  describe('on valid message with payload from agent', () => {
    it('sends message to game master with agentID', (done) => {
      const validMessage = {
        messageID : 4,
        //timeSent : '2020-03-20T19:24:10.255Z',
        payload : {askedAgentID : 1337}
      };
      const expResp = {
        messageID : 4,
        //timeSent : '2020-03-20T19:24:10.255Z',
        payload : {askedAgentID : 1337},
        agentID : agentID
      };

      passedToOtherHelper(client, master, validMessage, expResp, done);
    });
  });

  describe('on valid message without payload from agent', () => {
    it('sends message to game master with agentID', (done) => {
      const validMessage = {
        messageID : 1,
        //timeSent : '2020-03-20T19:24:10.255Z'
      };
      const expResp = {
        messageID : 1,
        //timeSent : '2020-03-20T19:24:10.255Z',
        agentID : agentID
      };

      passedToOtherHelper(client, master, validMessage, expResp, done);
    });
  });

  describe('on valid message from master', () => {
    it('strips agentID, then sends message to specified agent', (done) => {
      const validMessage = {
        messageID : 101,
        //timeSent : '2020-03-20T19:24:10.255Z',
        payload : {},
        agentID : agentID
      };
      const expResp = {
        messageID : 101,
        payload : {},
       // timeSent : '2020-03-20T19:24:10.255Z',
      };

      passedToOtherHelper(master, client, validMessage, expResp, done);
    });
  });

  describe('on message without required fields', () => {
    it('sends back missing fields error', (done) => {
      const missingFieldsMessage = {field : 'value'};
      const expResp = {
        error : {
          details : 'Missing properties.',
          missingProperites : [ 'messageID'/*, 'timeSent'*/ ]
        }
      };

      sendReceiveHelper(client, missingFieldsMessage, expResp, done);
    });
  });

  describe('on message without required payload', () => {
    it('sends back missing fields error', (done) => {
      const missingPayloadMessage = {
        messageID : 4,
        //timeSent : '2020-03-20T19:24:10.255Z'
      };
      const expResp = {
        error :
            {details : 'Missing properties.', missingProperites : [ 'payload' ]}
      };

      sendReceiveHelper(client, missingPayloadMessage, expResp, done);
    });
  });

  describe('on message with invalid messageID', () => {
    it('sends back invalid messageID error', (done) => {
      const invalidMessageID = 999;
      const invalidIdMessage = {
        messageID : invalidMessageID,
        //timeSent : '2020-03-20T19:24:10.255Z'
      };
      const expResp = {
        error : {details : 'Invalid messageID.', messageID : invalidMessageID}
      };

      sendReceiveHelper(client, invalidIdMessage, expResp, done);
    });
  });

  describe('on message with invalid payload', () => {
    it('sends back invalid payload error', (done) => {
      const invalidPayloadMessage = {
        messageID : 4,
        //timeSent : "2020-03-20T19:24:10.255Z",
        payload : 1
      };
      const expResp = {error : {details : 'Payload should be an object.'}};

      sendReceiveHelper(client, invalidPayloadMessage, expResp, done);
    });
  });

  describe('on message with invalid JSON', () => {
    it('sends back invalid JSON error', (done) => {
      const invalidMessage = "invalidMessage}";
      const expResp = {error : {details : 'Invalid JSON.'}};

      sendReceiveHelper(client, invalidMessage, expResp, done, true);
    });
  });

  describe('on gameMaster message from client', () => {
    it('sends back invalid type error', (done) => {
      const invalidTypeMessage = {
        messageID : 101,
        //timeSent : '2020-03-20T19:24:10.255Z',
        payload : {},
        agentID : agentID
      };
      const expResp = {
        error : {
          details : 'This message is not permitted with your connection.',
          permittedConnectionType : 'gameMaster'
        }
      };

      sendReceiveHelper(client, invalidTypeMessage, expResp, done);
    });
  });

  describe('on client message from gameMaster', () => {
    it('sends back invalid type error', (done) => {
      const invalidTypeMessage = {
        messageID : 1,
        //timeSent : '2020-03-20T19:24:10.255Z',
        payload : {},
        agentID : agentID
      };
      const expResp = {
        error : {
          details : 'This message is not permitted with your connection.',
          permittedConnectionType : 'agent'
        }
      };

      sendReceiveHelper(master, invalidTypeMessage, expResp, done);
    });
  });

  describe('on gameStarted message from master', () => {
    it('changes state to GAME_STARTED', (done) => {
      const gameStartedMessage = {
        messageID : config.messages.gameStarted.code,
        //timeSent : '2020-03-20T19:24:10.255Z',
        agentID : agentID,
        payload : {}
      };

      communicationServer.master.once('served', () => {
        assert.equal(communicationServer.state, States.GAME_STARTED);
        done();
      });

      master.networker.send(JSON.stringify(gameStartedMessage));
    });
  });

  describe('on gameEnded message from master', () => {
    it('changes state to GAME_ENDED', (done) => {
      const gameStartedMessage = {
        messageID : config.messages.gameEnded.code,
        //timeSent : '2020-03-20T19:24:10.255Z',
        agentID : agentID,
        payload : {}
      };

      communicationServer.master.once('served', () => {
        assert.equal(communicationServer.state, States.GAME_ENDED);
        done();
      });

      master.networker.send(JSON.stringify(gameStartedMessage));
    });
  });

  describe('on client connection closed', () => {
    it('ends connection and sends allAgentsLeft to GM', (done) => {
      const connectionsBefore = Object.keys(communicationServer.clients).length;
      // Add test socket close handler, so we know when socket closes
      communicationServer.clients[agentID].on('close', () => {
        const connectionsAfter =
            Object.keys(communicationServer.clients).length;
        // Client count should decrease by 1
        assert.equal(connectionsBefore - 1, connectionsAfter);
      });

      // Check GM message
      master.once('served', (data) => {
        const response = JSON.parse(data.toString('utf8'));
        const expResp = {messageID : config.messages.allAgentsLeft.code, payload : {}};
        assert.deepEqual(response, expResp);
        done();
      });

      client.end();
    });
  });

  describe('on master connection closed', () => {
    it('ends connection', (done) => {
      // Add test socket close handler, so we know when socket closes
      communicationServer.master.on('close', () => {
        assert.equal(communicationServer.master, null);
        done();
      });

      master.end();
    });
  });

  // Server should stop by itself now
});

/*
 * Sets a one time data handler which asserts response, then sends message.
 * @param {socket} socket - socket.
 * @param {object} message - Message to be sent.
 * @param {object} expResp - Expected response.
 * @param {function} done - Mocha `done` callback indicating test is done.
 * @param {boolean} noStringify -
 */
function passedToOtherHelper(from, to, message, expResp, done, noStringify) {
  to.once('served', (data) => {
    const response = JSON.parse(data.toString('utf8'));
    assert.deepEqual(response, expResp);
    done();
  });

  // Send message, handler should finish the work
  let msg = message;
  if (!noStringify) {
    msg = JSON.stringify(message);
  }
  from.networker.send(msg);
}

/*
 * Sets a one time data handler which asserts response, then sends message.
 * Data is expected to go back to the same socket.
 */
function sendReceiveHelper(socket, message, expResp, done, noStringify) {
  passedToOtherHelper(socket, socket, message, expResp, done, noStringify);
}
