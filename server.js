/**
 * DevGear - starts the server.
 *
 * The application itself is built in src/app.js. This file only decides which
 * port it listens on, so that tests can build the same app without one.
 */

require('dotenv').config();

const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;

createApp().listen(PORT, () => {
  console.log(`DevGear running at http://localhost:${PORT}`);
});
