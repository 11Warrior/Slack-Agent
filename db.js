import { Pool } from "pg";
import { log } from "./utils";

const dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
});

dbPool.on('connect', () => (
    log.info(`Database connected`)
))

dbPool.on('error', (error) => (
    log.error('Error connecting to db', error.message)
))

export async function saveToDb(aiAnalysis, userInfo) {
    try {
        const client = await connectDB();


    } catch (error) {

    }
    finally {
        client.release();
    }
}

export async function markAsSentToSlack(userInfo, analysis) {
    try {
        const client = await connectDB();


    } catch (error) {

    }
    finally {
        client.release();
    }
}

export async function connectDB() {
    //connects to rendr postgres db
    // await 
    try {
        log.info('Connecting to the db');
        const client = await dbPool.connect();
        return client;
    } catch (error) {
        log.error('Error connecting to the db', error.message);
        throw error;
    }
}

export async function closeDB() {
    try {
        log.info('Closing the connection to the db');
        await dbPool.end();
    } catch (error) {
        log.error('Error while closing the db', error.message);
        throw error;
    }
}