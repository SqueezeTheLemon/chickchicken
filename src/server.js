import { createApp } from './app.js';
import { config } from './config.js';

createApp().listen(config.port, () => {
  console.log(`🐔 chickchicken running → http://localhost:${config.port}`);
  console.log(`   data dir: ${config.dataDir}`);
});
