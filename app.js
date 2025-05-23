import dotenv from 'dotenv'
import fs from 'fs'
import http from 'http'
import { Octokit, App } from 'octokit'
import { createNodeMiddleware } from '@octokit/webhooks'
import OpenAI from "openai";

// Load environment variables from .env file
dotenv.config()
const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});
// Set configured values
const appId = process.env.APP_ID
const privateKeyPath = process.env.PRIVATE_KEY_PATH
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
const secret = process.env.WEBHOOK_SECRET
const enterpriseHostname = process.env.ENTERPRISE_HOSTNAME
const messageForNewPRs = fs.readFileSync('./message.md', 'utf8')

// Create an authenticated Octokit client authenticated as a GitHub App
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  },
  ...(enterpriseHostname && {
    Octokit: Octokit.defaults({
      baseUrl: `https://${enterpriseHostname}/api/v3`
    })
  })
})

// Optional: Get & log the authenticated app's name
const { data } = await app.octokit.request('/app')

// Read more about custom logging: https://github.com/octokit/core.js#logging
app.octokit.log.debug(`Authenticated as '${data.name}'`)

// Subscribe to the "pull_request.opened" webhook event
app.webhooks.on('pull_request.opened', async ({ octokit, payload }) => {
  console.log(`Received a pull request event for #${payload.pull_request.head}`)
  
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pull_number = payload.pull_request.number;
  // Initiate result value
  const result = "Hi, this is a comment from the bot.";
  try {
    // Fetch the list of files changed in the PR
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number
    });
    // hello i am just adding a comment for testing 
    console.log(`Files changed in PR #${pull_number}:`);
    const changes_list = [];
    for (const file of files) {
      console.log(`- ${file.filename} (${file.status})`);
      console.log(`  Changes: ${file.changes}`);
      console.log(`  Patch:\n${file.patch}\n`);
      let dictionary_file = {"File Info": `${file.filename} (${file.status})`, "Changes":`${file.changes}`, "Patch":`${file.patch}`};
      changes_list.push(dictionary_file);
    }
    const completion = openai.chat.completions.create({
      model: "gpt-4o-mini",
      store: true,
      messages: [
        {"role": "user", "content":
           `You are a senior software developer. Analyze these PR changes that have been made into the repository. Provide your response in 3 sections. First, provide a summary about what all of the changes will achieve for the project. This should be a concise statement that should be direct and explain all the integrations/logic that is executed. In the next section, you need to discuss changes of concern. Start  by mentioning the file name and below that add the line of concern. After the line of code, explain on the next line on why this logic might be flawed. Be quantitative and specific. Here are all the changes that have been made for the PR: ${changes_list} `},
      ],
    });
    completion.then((result) => {
      result = result.choices[0].message
    });
  } catch (error) {
    console.error(`Error fetching file changes: ${error.message}`);
  }
  try {
    await octokit.rest.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: result
    })
  } catch (error) {
    if (error.response) {
      console.error(`Error! Status: ${error.response.status}. Message: ${error.response.data.message}`)
    } else {
      console.error(error)
    }
  }
})

// Optional: Handle errors
app.webhooks.onError((error) => {
  if (error.name === 'AggregateError') {
    // Log Secret verification errors
    console.log(`Error processing request: ${error.event}`)
  } else {
    console.log(error)
  }
})

// Launch a web server to listen for GitHub webhooks
const port = process.env.PORT || 3000
const path = '/api/webhook'
const localWebhookUrl = `http://localhost:${port}${path}`

// See https://github.com/octokit/webhooks.js/#createnodemiddleware for all options
const middleware = createNodeMiddleware(app.webhooks, { path })

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening for events at: ${localWebhookUrl}`)
  console.log('Press Ctrl + C to quit.')
})
