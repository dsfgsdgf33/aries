const path = require('path');
const baseDir = __dirname;

const mods = ['ai','tools','memory','system','events','swarm','swarm-coordinator','task-queue',
  'plugin-loader','self-heal','api-server','smart-router','pipelines','war-room','ai-gateway','extension-bridge'];

mods.forEach(m => {
  try {
    require(path.join(baseDir, 'core', m));
    console.log(m + ' OK');
  } catch(e) {
    console.log(m + ' FAIL: ' + e.message.split('\n')[0]);
  }
});
