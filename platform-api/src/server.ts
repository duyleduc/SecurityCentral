import { app } from './app.js';
import { env } from './lib/env.js';

const port = env.PORT;

app.listen(port, () => {
  console.log(`[platform-api] Server running on port ${port} (${env.NODE_ENV})`);
});
