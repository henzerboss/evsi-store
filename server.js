// file: server.js

// Эта строка - самое главное. Она загружает все переменные из вашего .env файла.
require('dotenv').config({ path: './.env' });

// Этот код просто запускает ваш обычный Next.js сервер
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// Берем порт из package.json или по умолчанию
const port = parseInt(process.env.npm_config_port, 10) || 10000;
const hostname = '0.0.0.0';

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});