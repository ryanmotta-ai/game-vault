try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE test(id INT)');
  console.log('SUCCESS: better-sqlite3 loaded and executed in Electron!');
  process.exit(0);
} catch (err) {
  console.error('ERROR loading better-sqlite3:', err.message);
  process.exit(1);
}
