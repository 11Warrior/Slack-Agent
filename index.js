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

            if (analysisId) {
                
            }
            // return aiAnalysis;

        } catch (error) {
            log.error('Error analyzing and posting data', error.message);
            throw error;
        }
    }

    async saveToDb(aiAnalysis, userInfo) {
        try {

            
        } catch (error) {

        }
    }

    async AIAnalysis(userInfo, researchedData) {
        const prompt = new ChatPromptTemplate(
            `Analyze this new community member for fit with our commercial product.

            Company: ${process.env.COMPANY_NAME || 'Your Company'}
            Product: ${process.env.COMPANY_PRODUCT || 'Your Product'}

            Member:
            - Name: {name}
            - Email: {email}
            - Title: {title}

            Research Data:
            {research}

            Provide a JSON response with:
            - fitScore (0-100): likelihood they'd be interested in our product
            - insights: array of 3-5 key observations
            - recommendations: array of 2-4 engagement suggestions

            Consider job title, company size, technical background, and budget 
            authority.`
        );

        //research summary = title : content
        const researchSummary = researchedData.length > 0 ? researchedData.map(r => (`${r.tittle} : ${r.content}`)).join('\\n') : 'Limited Reasearch data provided';

        const chain = prompt.pipe(this.AIModel);

        const response = chain.invoke({
            name: userInfo.name,
            email: userInfo.email,
            title: userInfo.title,
            research: researchSummary
        });

        const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim()

        return JSON.parse(cleanedResponse);

    }

    async doResearch(userinfo) {
        //extract company info, github data of the user
        const researchData = [];
        const email = userinfo.email;

        const domain = email.split('@')[1];

        const companyInfo = await this.getCompanyInfo(domain, userinfo);
        const githubInfo = await this.getGithubInfo(userinfo.name);

        if (companyInfo) {
            researchData.push(companyInfo);
        }

        if (githubInfo) {
            researchData.push(githubInfo);
        }

        if (researchData.length > 0) {
            return researchData
        }

        return null;
    }

    async getCompanyInfo(domain, userInfo) {
        try {
            const res = await axios.get(`https://www.${domain}`, {
                timeout: 5000,
                headers: 'User-Agent : Mozilla/5.0'
            });

            const titleMatch = res.data.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : `Company : ${domain}`

            return {
                'url': `https://www.${domain}`,
                'content': `Company website for ${domain}`,
                'title': title,
                'type': 'company'
            }

        } catch (error) {
            log.error('Error getting company Information', error.message);
            return null;
        }
    }

    async getGithubInfo(name) {
        try {
            const res = await axios.get(`https://api.github.com/search/users/?q=${encodeURIComponent(name)}`);
            const githubUsers = res.data.items;

            if (githubUsers.length > 0) {
                const userGithubProfile = githubUsers[0];
                return {
                    'url': userGithubProfile.html_url,
                    'content': `Github Repos : ${userGithubProfile.public_repos}`,
                    'title': userGithubProfile.login,
                    'type': `Github : ${userGithubProfile.login}`
                }
            } else {
                return null;
            }
        } catch (error) {
            log.error('Error getting Github Information', error.message);
            return null;
        }
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