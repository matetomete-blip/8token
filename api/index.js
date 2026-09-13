const app = require('../server.js');

// Vercel @vercel/node expects a handler function (req, res)
module.exports = (req, res) => {
  app(req, res);
};