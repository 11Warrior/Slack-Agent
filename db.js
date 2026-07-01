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

export async function initDb() {
    try {
        const client = await connectDB();

        await client.query(`
             CREATE TABLE  IF NOT EXISTS user_analysis (
                id SERIAL PRIMARY_KEY,
                user_id VARCHAR(255),
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                title VARCHAR(255),
                analysis_id VARCHAR(255),
                timezone VARCHAR(255),
                fitscore INTEGER NOT NULL,
                insights JSONB,
                recommendations JSONB,
                research_data JSONB,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                posted_to_slack BOOLEAN DEFAULT FALSE,
                sent_to_slack_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             )`
        )


        await client.query(`CREATE INDEX user_id_idx ON user_analysis(user_id)`);

        await client.query(`CREATE INDEX analysis_id_idx ON user_analysis(analysis_id)`); 4

        log.info('Creating DB');

    } catch (error) {
        log.error('Failed to initialize the db', error.message);
    }
}

export async function saveToDb(aiAnalysis, userInfo, researchData) {
    try {
        const client = await connectDB();
        const res = await client.query(`
            INSERT INTO user_analysis (
                user_id,
                name,
                email,
                title,
                timezone,
                fitscore,
                recommendations,
                research_data,
                insights
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
            `, [
            userInfo.id,
            userInfo.name,
            userInfo.email,
            userInfo.title,
            userInfo.timezone,
            aiAnalysis.fitScore,
            JSON.stringify(aiAnalysis.recommendations),
            JSON.stringify(researchData),
            JSON.stringify(aiAnalysis.insights)
        ])

        log.info('Writing to DB');

        return res.rows[0].id;

    } catch (error) {
        log.error('Failed to write to db', error.message);
        throw error;
    }
    finally {
        client.release();
    }
}

export async function markAsSentToSlack(analysisId) {
    try {
        const client = await connectDB();

        await client.query(`
            UPDATE user_analysis 
            SET posted_to_slack = TRUE,
            sent_to_slack_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
            WHERE analysis_id = $1
        `, [analysisId])

    } catch (error) {
        log.error('Failed to mark as sent', error.message);
        throw error;
    }
    finally {
        client.release();
    }
}

export async function connectDB() {
    //connects to rendr postgres db
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