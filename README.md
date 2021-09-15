# Communication Server

## Usage

- `npm install` to install dependencies.
- `npm test` to run tests.
- `npm start` to launch the server.
- `npm run debug` to launch the server in debug mode.
- Extra: `ncat localhost <port>` - launches dumb netcat client.

### Config

- `agentPort` - port, przez który łączą się gracze.
- `masterPort` - port, przez który łączy się GM.
- `maxConnections` - maksymalna liczba jednocześnie połączonych agentów.

## Links

- [Jakiś przykładowy klient w C#](https://jckjaer.dk/2016/07/06/sending-utf-8-json-through-tcpclient-in-c/)
- [Dokumentacja modułu `net`](https://nodejs.org/api/net.html)
- [mocha](https://mochajs.org/#run-cycle-overview)
