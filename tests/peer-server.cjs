// A local PeerJS introduction server for the tests (127.0.0.1:9000). Pages use it with ?signal=127.0.0.1:9000.
const { PeerServer } = require('peer')
PeerServer({ port: 9000, host: '127.0.0.1', path: '/' }, () => console.log('peer server up'))
