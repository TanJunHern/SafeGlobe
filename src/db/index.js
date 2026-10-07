const config = require('../config');
const SqliteDatabase = require('./sqlite');

// Database abstraction layer
let instance = null;

function getDb() {
  if (!instance) {
    if (config.dbType === 'sqlite') {
      instance = new SqliteDatabase(config.dbPath);
    } else {
      // Future GCP Firestore or Cloud SQL adapter
      console.warn(`Database type "${config.dbType}" not yet configured, falling back to SQLite`);
      instance = new SqliteDatabase(config.dbPath);
    }
  }
  return instance;
}

module.exports = {
  getDb
};
