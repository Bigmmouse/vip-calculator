const mysql = require("mysql2");

const pool = mysql.createPool({
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "123456",
  database: "calculator_app",
  waitForConnections: true,
  connectionLimit: 10
});

module.exports = pool.promise();
