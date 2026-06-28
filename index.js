// Slack API setup
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import axios from "axios";
import { express } from express;
import { config } from "dotenv";

config();

//logging
const log = {
    info: (message, ...args) => (console.log(`[INFO]  ${message}`, ...args)),
    error: (message, ...args) => (console.log(`[ERR]  ${message}`, ...args)),
    debug: (message, ...args) => (process.env.NODE_ENV === 'development' && console.log(`[DEBUG]  ${message}`, ...args))
}

//slack bot init
class SlackBot {
    constructor() {
        this.app = express();
        this.PORT = process.env.PORT;
        this.slack_app = new App({
            token: process.env.TOKEN,
            appToken: process.env.APP_TOKEN,
            signingSecret: process.env.SIGNING_SECRET,
            socketMode: true,
        })

        this.WebClient = new WebClient(process.env.SLACK_BOT_TOKEN);

        this.AIModel = new ChatOpenAI({
            model: 'gpt-4',
            temperature: 0.3,
            apiKey: process.env.OPENAI_API_KEY
        })

        this.SetUpSlackEvents();
        this.SetUpExpress();
    }

    SetUpSlackEvents() {
        this.slack_app.event('team_join', async ({ event }) => {
            try {
                log.info('New Member joined : ', event.user.name);
                const userInfo = await getUserInfo(event.user.id);
                this.AnalyzeAndPost(userInfo);
            } catch (error) {
                log.error('Error joining the team', error.message);
            }
        })

        this.slack_app.event('member_joined_channel', async ({ event }) => {
            try {
                if (event.channel_type === 'C') {
                    log.info(`New Member ${event.user.name} joined channel ${event.channel.name}`,);
                }

                const userInfo = await getUserInfo(event.user.id);
                this.AnalyzeAndPost(userInfo);
            } catch (error) {
                log.error('Error joining the channel', error.message);
            }
        })

        this.slack_app.error(async (error) => log.error('Slack Error', error.message))
    }

    SetUpExpress() {
        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        })

            // this.app.listen(this.PORT, () => {
            //     console.log('Server listening at port', this.PORT);
            // })

            ((process.env.NODE_ENV === 'development') && (
                this.app.get('/test/analysis-and-post', (req, res) => {
                    try {
                        const { userinfo } = req.body;
                        if (!userinfo) res.status(400).json({ message: "User Info is not in the req body" })
                        this.AnalyzeAndPost(userinfo);
                    } catch (error) {
                        log.error('Failed to analyze and post user while testing', error.message);
                    }
                })
            ))
    }

    async AnalyzeAndPost(userInfo) {
        //openai analysis and report generation
        //saves to db and post to the slack
        let analysisId = null;
        try {
            const researchedResult = await this.doResearch(userInfo);
            const aiAnalysis = await this.AIAnalysis(userInfo, researchedResult);

            analysisId = await this.saveToDb(aiAnalysis, userInfo);
            

            return aiAnalysis;
        } catch (error) {
            log.error('Error analyzing and posting data', error.message);
            throw error;
        }

    }

    async AIAnalysis(userInfo, researchedData) {

    }

    async doResearch(userinfo) {
        //extract company info, github data of the user


    }

    async getUserInfo(userId) {
        const res = await this.WebClient.users.info({ user: userId });
        const user = res.user;

        return {
            id: user.id,
            name: user.name,
            profile: {
                fistname: user?.profile.first_name,
                lastname: user?.profile.last_name,
                status: user?.profile.status_text
            },
            email: user.profile.email,
            title: user.profile.title,
            timezone: user.tz
        }
    }

    async connectDB() {
        //connects to rendr postgres db
        // await 


    }
}