import fetch from "node-fetch";

// The local LM Studio OpenAI-compatible endpoint
const LM_STUDIO_URL = "http://127.0.0.1:1234/v1/chat/completions";

const PLAYWRIGHT_TOOLS = [
  {
    type: "function",
    function: {
      name: "navigate",
      description: "Navigate to a given URL using the Playwright browser.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The valid URL to navigate to" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click an element matching the given CSS selector.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "The CSS selector of the element to click" }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "screenshot",
      description: "Take a screenshot of the current page.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "What to name the screenshot (e.g. 'home.png')" }
        },
        required: ["filename"]
      }
    }
  }
];

// Mock executions for the tools
const mockExecuteTool = {
  navigate: (args) => {
    console.log(`\n  => [MCP: Playwright] browser.newPage().goto('${args.url}')`);
    return { success: true, pageTitle: "Hacker News", content: "<html><body><button id='login-btn'>Login</button></body></html>" };
  },
  click: (args) => {
    console.log(`\n  => [MCP: Playwright] page.locator('${args.selector}').click()`);
    return { success: true, navigatedTo: "https://example.com/login" };
  },
  screenshot: (args) => {
    console.log(`\n  => [MCP: Playwright] page.screenshot({ path: '${args.filename}' })`);
    return { success: true, savedPath: `/tmp/${args.filename}` };
  }
};

async function main() {
  console.log("Starting Complex MCP / Playwright Test against LM Studio API...\n");

  const messages = [
    { role: "system", content: "You are a web automation agent with access to a headless browser." },
    { role: "user", content: "Can you go to https://news.ycombinator.com, click the login button, and take a screenshot named 'hn-login.png'?" }
  ];

  let loopCounter = 0;
  
  while (loopCounter < 5) {
    loopCounter++;
    
    console.log(`[Turn ${loopCounter}] Asking model...`);
    const resp = await fetch(LM_STUDIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "any-model", // LM Studio uses loaded model
        messages: messages,
        tools: PLAYWRIGHT_TOOLS,
        tool_choice: "auto",
        temperature: 0.1
      })
    });

    if (!resp.ok) {
      console.error("Failed to connect or bad request:", await resp.text());
      return;
    }

    const { choices } = await resp.json();
    const message = choices[0].message;

    // Append model's response to history
    messages.push(message);

    if (message.content) {
      console.log(`[Assistant]: ${message.content}`);
    }

    if (message.tool_calls) {
      console.log(`\n[Assistant demands ${message.tool_calls.length} tool execution(s)]`);
      for (const call of message.tool_calls) {
        console.log(`  - Invoking Function: ${call.function.name} | Args: ${call.function.arguments}`);
        
        let toolResult;
        try {
          const args = JSON.parse(call.function.arguments);
          const executor = mockExecuteTool[call.function.name];
          if (executor) {
            toolResult = JSON.stringify(executor(args));
          } else {
            toolResult = JSON.stringify({ error: `Tool ${call.function.name} not found in MCP mock` });
          }
        } catch(e) {
          toolResult = JSON.stringify({ error: e.message });
        }

        messages.push({
          role: "tool",
          name: call.function.name,
          tool_call_id: call.id,
          content: toolResult
        });
      }
    } else {
      console.log("\n[Goal Achieved] Model stopped requesting tools.");
      break;
    }
  }
}

main().catch(console.error);
