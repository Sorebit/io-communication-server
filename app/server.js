// Usage:
// --debug|-d : Launches in debug mode

'use strict';

const readline = require('readline');
const winston = require('winston');
const config = require('../config');
const {CommunicationServer} = require('./CommunicationServer');

const {createLogger, format} = require('winston');
const {combine, timestamp, label, printf} = format;

// const myFormat = format.printf(({ level, message, label, timestamp }) => {
//   return `${timestamp} [${level}] : ${message}`;
// });

const transports = {
  // - Write all logs with level `info` and below to console
  console : new winston.transports.Console({format : format.prettyPrint()}),
  // - Write all logs with level `debug` and below to console
  debugConsole : new winston.transports.Console(
      {level : 'debug', format : format.prettyPrint()}),
  // - Write all logs with level `error` and below to `error.log`
  errorFile : new winston.transports.File(
      {filename : 'logs/error.log', level : 'error'}),
  // - Write all logs with level `info` and below to `combined.log`
  combinedFile : new winston.transports.File({filename : 'logs/combined.log'}),
};

const logger = winston.createLogger({
  level : 'debug',
  format : format.combine(format.timestamp(), format.json()),
  transports : [ transports.errorFile, transports.combinedFile ]
});

// // Enable debug mode if specified
if (process.argv[2] === '--debug' || process.argv[2] === '-d') {
  logger.add(transports.debugConsole);
  logger.info('Debug mode ON');
} else {
  logger.add(transports.console);
}

const communicationServer = new CommunicationServer(config, logger);

// Handle ctrl+c on both Windows and sane systems
if (process.platform === 'win32') {
  const inter = readline.createInterface(
      {input : process.stdin, output : process.stdout});

  inter.on('SIGINT', function() { process.emit('SIGINT'); });
}

// Graceful shutdown
process.on('SIGINT', function() {
  logger.debug('Got SIGINT');
  communicationServer.stop(() => {
    logger.debug('CALLBACK');
    process.exit();
  });
});

// Main entry point
communicationServer.start();
