import { createApp } from '../../server/index.js';
import { closeStateStore } from '../../server/state-store.js';
const app = await createApp({ apiOnly: true });
const server = app.listen(0, '127.0.0.1', () => process.send?.({ port: (server.address() as { port: number }).port }));
process.on('message', message => { if (message === 'stop') { server.closeAllConnections(); server.close(() => { closeStateStore(); process.exit(0); }); } });
