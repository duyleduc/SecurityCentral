import { createServer } from 'node:http';

import { app } from './app.js';
import { env } from './lib/env.js';
import { setupWebSocket } from './ws/index.js';

const port = env.PORT;

// Create HTTP server (shared by Express + Socket.IO)
const httpServer = createServer(app);

// Attach WebSocket server
setupWebSocket(httpServer);

httpServer.listen(port, () => {
  console.log(`[platform-api] Server running on port ${port} (${env.NODE_ENV})`);
});
