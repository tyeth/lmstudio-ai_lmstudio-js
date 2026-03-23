import { LMStudioClient, tool } from '@lmstudio/sdk';
import { z } from 'zod';

const client = new LMStudioClient({ baseUrl: 'ws://127.0.0.1:1234' });

const navigate = tool({
  name: 'playwright_navigate',
  description: 'Navigate to a web page using a simulated browser.',
  parameters: { url: z.string() },
  implementation: async ({ url }) => {
    console.log(`[MCP Server: Playwright] Navigating to ${url}...`);
    return { url, title: 'Example Domain', content: '<html><body><h1>Welcome to Example</h1><button id="login">Login</button></body></html>' };
  }
});

const click = tool({
  name: 'playwright_click',
  description: 'Simulates a mouse click on an element by CSS selector.',
  parameters: { selector: z.string() },
  implementation: async ({ selector }) => {
    console.log(`[MCP Server: Playwright] Clicking element: ${selector}...`);
    return { success: true, newContent: '<html><body><h1>Dashboard</h1><p>Secret content</p></body></html>' };
  }
});

async function runPlaywrightTest() {
  console.log('Fetching model...');
  const model = await client.llm.model();
  
  console.log('Sending complex task to model...');
  const result = await model.act(
    'Navigate to https://example.com, and then click the #login button to see what happens.',
    [navigate, click],
    {
      onMessage: (msg: any) => {
        if (msg.role === 'assistant' && msg.content) {
          process.stdout.write(msg.content);
        }
      }
    }
  );
  
  console.log('\nFinal Output:', result.content);
}

runPlaywrightTest().catch(console.error);
