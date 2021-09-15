# TCP server used as part of uni team-project

> Basically, the project was a modular game where bots compete against each other in simple team matches.
> Each team developed a server (this repo), a Game Master (a client handling game logic), and Agents (bots playing the game).
> 
> Then a tournament would be played to tell which team won. There were rounds where each team would provide their modules
> and if it handled games correctly, points scored by teams of bots would be summed up to determine the ultimate winner.
> 
> Pretty complicated.

## Features

- Communication with other modules over **TCP**
- Logs (winston)
    - colorful in tty (chalk)
    - as json in log file
- [Tests](./test) (mocha)
- Implemented as a Finite State Machine
- *Probably* extendable to support other usecases

## Usage

- `npm install` - install dependencies.
- `npm test` - run tests.
- `npm start` - launch the server.
- `npm run debug` - launch the server in debug mode.
- Extra: `ncat localhost <port>` - launch dumb netcat client.

### Config

- `agentPort` - port used by **players**.
- `masterPort` - port used by **GameMaster**.
- `maxConnections` - max simultaneous **agent connections**.
