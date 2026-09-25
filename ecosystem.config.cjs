// Alternativa sem Docker: npm ci && npm run build && pm2 start ecosystem.config.cjs
module.exports = { apps: [{ name: 'atelie', script: 'node_modules/next/dist/bin/next', args: 'start -p 3000', env: { NODE_ENV: 'production' } }] };
