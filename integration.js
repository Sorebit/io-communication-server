'use strict';

const {exec} = require('child_process');
const readline = require('readline');
const winston = require('winston');
const chalk = require('chalk');
const config = require('./config');
const {CommunicationServer} = require('./app/CommunicationServer');

const {createLogger, format} = require('winston');
const {combine, timestamp, label, printf} = format;

const logger = winston.createLogger({
  level : 'debug',
  format : format.combine(format.timestamp(), format.json()),
  transports : [ new winston.transports.Console({level : 'error'}) ]
});

//
// INTEGRATION TESTING
//

const expectingResponse = {};

function agentMsgHandler(message, agentID) {
  // console.log(chalk.magenta('AGENT MSG'), message);
  if (!expectingResponse[agentID]) {
    expectingResponse[agentID] = {};
    expectingResponse[agentID].in = 0;
    expectingResponse[agentID].out = 0;
  }
  expectingResponse[agentID].out += 1;

  const mIn = expectingResponse[agentID].in;
  const mOut = expectingResponse[agentID].out;
  const io = `(out: ${mOut}, in: ${mIn})`;

  console.log(chalk.gray(`Agent ${agentID} expecting response. ${io}`));
}

function masterMsgHandler(message, agentID) {
  // console.log(chalk.yellow('MASTER MSG to'), chalk.magenta(`AID
  // ${agentID}`));
  if (expectingResponse[agentID] &&
      expectingResponse[agentID].in !== expectingResponse[agentID].out) {
    expectingResponse[agentID].in += 1;

    const mIn = expectingResponse[agentID].in;
    const mOut = expectingResponse[agentID].out;
    const io = `(out: ${mOut}, in: ${mIn})`;

    console.log(chalk.green(`Agent ${agentID} got their response. ${io}`));
  }
}

const communicationServer =
    new CommunicationServer(config, logger, agentMsgHandler, masterMsgHandler);

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

const agentPath = '../PlayerModule/PlayerModule/PlayerModule.csproj';
const masterPath = '../GameMaster/TheProjectGame/TheProjectGame.csproj';
const cmd = 'dotnet run --no-build --project';
const agentConfig = 'testConfig.json';

const execIoHandler = (error, stdout, stderr) => {
  if (error) {
    console.log(`error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.log(`stderr: ${stderr}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
};

setTimeout(() => {
  console.log(chalk.yellow('Starting KURCZE MASTER'));
  exec(`${cmd} ${masterPath}`, execIoHandler);
}, 2000);

// Run agent 1
setTimeout(() => {
  console.log(chalk.blue('Starting KURCZE AGENT BLUE'));
  exec(`${cmd} ${agentPath} Blue ${agentConfig}`, execIoHandler);

  console.log(chalk.red('Starting KURCZE AGENT RED'));
  exec(`${cmd} ${agentPath} Red ${agentConfig}`, execIoHandler);
}, 6000);

// Main entry point
communicationServer.start();
