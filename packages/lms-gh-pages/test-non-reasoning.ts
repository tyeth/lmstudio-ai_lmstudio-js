import { LMStudioClient } from '@lmstudio/sdk';

async function main() {
  const client = new LMStudioClient({ baseUrl: 'ws://192.168.1.207:1234' });
  const model = (await client.llm.listLoaded())[0];
  
  const p = model.respond([{ role: 'user', content: 'waht is opposite of up' }], {
    reasoningParsing: { enabled: true, startString: '<think>', endString: '</think>' }
  });

  const res = await p;
  console.log('--- content ---');
  console.log(res.content);
  console.log('--- nonReasoningContent ---');
  console.log(res.nonReasoningContent);
}
main().catch(console.error);