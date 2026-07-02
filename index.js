// Slack API setup
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import axios from "axios";
import express from "express";
import { config } from "dotenv";
import { log } from "./utils.js";
import { initDb, markAsSentToSlack, saveToDb } from "./db.js";
import { ChatGroq } from "@langchain/groq";

config();

//slack bot init
class SlackBot {

    constructor() {
        this.app = express();
        this.PORT = process.env.PORT || 3000;
        this.slack_app = new App({
            token: process.env.SLACK_BOT_TOKEN,
            appToken: process.env.SLACK_APP_TOKEN,
            signingSecret: process.env.SIGNING_SECRET,
            socketMode: true,
        })

        this.WebClient = new WebClient(process.env.SLACK_BOT_TOKEN);

        this.AIModel = new ChatGroq({
            model: "llama-3.1-8b-instant",
            temperature: 0.3,
            apiKey: process.env.GROK_API_KEY
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
        this.app.use(express.json());

        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy', timestamp: new Date().toISOString() });
        })

        if (process.env.NODE_ENV === 'development') {
            this.app.post('/test/analysis-and-post', async (req, res) => {
                try {
                    // console.log(req.body);
                    const { userinfo } = req.body;
                    if (!userinfo) res.status(400).json({ message: "User Info is not in the req body" });

                    const analysis = await this.AnalyzeAndPost(userinfo);

                    res.json({
                        sucess: true,
                        analysis,
                        timestamp: new Date().toISOString()
                    })
                } catch (error) {
                    log.error('Failed to analyze and post user while testing', error.message);
                }
            })
        }
    }

    async AnalyzeAndPost(userInfo) {
        //openai analysis and report generation
        //saves to db and post to the slack
        let analysisId = null;
        try {
            const researchedResult = await this.doResearch(userInfo);
            const aiAnalysis = await this.AIAnalysis(userInfo, researchedResult);

            analysisId = await saveToDb(aiAnalysis, userInfo);
            await this.PostToChannel(userInfo, aiAnalysis);

            if (analysisId) {
                await markAsSentToSlack(analysisId);
            }
            return aiAnalysis;
        } catch (error) {
            log.error('Error analyzing and posting data', error.message);
            throw error;
        }
    }

    async PostToChannel(userInfo, analysis) {
        const color = analysis.fitScore >= 80 ? '#8ed76e' : analysis.fitScore > 60 ? '#e69138' : '#cc3434';

        const blocks = [
            {
                type: 'header',
                text: { type: 'plain_text', text: `New User added ${userInfo.name}` }
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `Fitscore : ${analysis.fitScore / 100}` },
                    { type: 'mrkdwn', text: `Email : ${userInfo.email}` },
                    { type: 'mrkdwn', text: `Title : ${userInfo.title}`  || 'Not Provided'}
                ]
            }
        ];

        if (analysis.insights) {
            blocks.push({
                type: 'section',
                fields: [{ type: 'mrkdwn', text: `Insights : ${analysis.insights}` || 'Failed to extract insights' }]
            });
        }

        if (analysis.recommendations) {
            blocks.push({
                type: 'section',
                fields: [{ type: 'mrkdwn', text: `Recommendations : ${analysis.recommendations}` || 'Failed to extract recommendations' }]
            });
        }

        blocks.push({
            type: 'context',
            elements: [{
                type: 'mrkdwn', text: `Analyzed : ${new Date().toISOString()}`
            }]
        });

        // console.log(blocks);

        await this.WebClient.chat.postMessage({
            channel: process.env.SLACK_CHANNEL_ID,
            text: `New User Analysis ${userInfo.name} : ${analysis.fitScore / 100}`,
            attachments: [{
                color: color,
                blocks: blocks
            }
            ]
        })

        log.info(`Analysis posted to channel for ${userInfo.name}`)
    }

    async AIAnalysis(userInfo, researchedData) {
        try {

            const prompt = ChatPromptTemplate.fromTemplate(
                `Analyze this new community member for fit with our commercial product. 
                Return ONLY valid JSON.

                Example:

                {{
                "fitScore": 70,
                "insights": ["Insight 1"],
                "recommendations": ["Recommendation 1"]
                }}
                
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

            const response = await chain.invoke({
                name: userInfo.name,
                email: userInfo.email || 'Not Provided',
                title: userInfo.title || 'Not Provided',
                research: researchSummary
            });

            const responseText = response.content || '';

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error(
                    `Model did not return JSON:\n${responseText}`
                );
            }

            const analysis = JSON.parse(jsonMatch[0]);

            return {
                fitScore: Math.max(0, Math.min(100, analysis.fitScore || 50)),
                insights: Array.isArray(analysis.insights) ? analysis.insights : ['Analysis Completed'],
                recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : ['Follow Up Recommended']
            }
        } catch (error) {
            log.error('Error while doing AI Analysis', error.message);
            return {
                fitScore: 50,
                insights: ['Failed to get the insights'],
                recommendations: ['Failed to get the recommendations']
            }
        }
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

    async getCompanyInfo(domain) {
        try {
            const result = await axios.get(`https://www.${domain}`, {
                timeout: 5000,
                headers: 'User-Agent : Mozilla/5.0'
            });

            const titleMatch = result.data.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1] : `Company : ${domain}`

            return {
                'url': `https://www.${domain}`,
                'content': `Company website for ${domain}`,
                'title': title,
                'type': 'company'
            }

        } catch (error) {
            log.info('Failed to get company Information', error.message);
            return null;
        }
    }

    async getGithubInfo(name) {
        try {
            const res = await axios.get(`https://api.github.com/search/users?q=${encodeURIComponent(name)}`);
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
            log.info('Failed to get Github Information', error.message);
            return null;
        }
    }

    async getUserInfo(userId) {
        const result = await this.WebClient.users.info({ user: userId });
        const user = result.user;

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

    async start() {
        try {
            log.info('Starting the agent');
            await initDb();

            const port = this.PORT;

            this.app.listen(port, (req, res) => (
                log.info('Started server on port ', port)
            ))

            if (this.NODE_ENV === 'development') {
                log.info(`In test environment the endpoint is localhost:${port}/test/analysis-and-post`);
            }

            this.slack_app.start();

            log.info('Starting slack app');

        } catch (error) {
            log.error('Error starting the agent', error.message);
            process.exit(1);
        }
    }

    async stop() {
        try {
            await closeDB();

            if (this.server) {
                await new Promise(resolve => this.server.close(resolve));
            }

            await this.slack_app.stop();
            log.info('Stopping agent..');

        } catch (error) {
            log.error('Error starting the agent');
            throw error;
        }
        process.exit(0);
    }
}

const agent = new SlackBot();

process.on('SIGINT', () => agent.stop());
process.on('SIGTERM', () => agent.stop());

agent.start().catch(e => {
    log.error('Error starting agent', e.message)
    process.exit(1);
});

export default agent;