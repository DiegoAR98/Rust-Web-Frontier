import { listen } from '@colyseus/tools';
import appConfig from './app.config.js';

await listen(appConfig, Number(process.env.PORT ?? 2567));
