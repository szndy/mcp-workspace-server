// Start with: pm2 start ecosystem.config.cjs
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const port = process.env.PORT || 3000;
const domain = process.env.NGROK_DOMAIN;

const apps = [
  {
    name: 'mcp-server',
    script: 'dist/index.js',
    cwd: __dirname,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    time: true,
    out_file: path.join(__dirname, 'logs', 'server.out.log'),
    error_file: path.join(__dirname, 'logs', 'server.err.log'),
    env: { NODE_ENV: 'production' },
  },
];

// The tunnel is only managed when NGROK_DOMAIN is set.
if (domain) {
  apps.push({
    name: 'mcp-tunnel',
    script: 'ngrok',
    interpreter: 'none',
    args: `http --url=${domain} ${port}`,
    autorestart: true,
    restart_delay: 5000,
    time: true,
  });
}

module.exports = { apps };
