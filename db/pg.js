import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
    user: "postgres",
    // host: "192.168.0.100",
     host: "localhost",
    database: "db_gps",
    password: "12345",
    port: 5432,
});