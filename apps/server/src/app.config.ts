import config from '@colyseus/tools';
import { WorldRoom } from './world-room.js';

export default config({
  initializeGameServer: (gameServer) => {
    gameServer.define('world', WorldRoom);
  },
});
