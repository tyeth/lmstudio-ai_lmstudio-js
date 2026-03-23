import { LMStudioClient } from '@lmstudio/sdk';

async function main() {
  const client = new LMStudioClient({ baseUrl: 'ws://192.168.1.207:1234' });
  const model = (await client.llm.listLoaded())[0];
  
  const p = model.respond([{ role: 'user', content: 'waht is opposite of up' }], {
    reasoningParsing: { enabled: true, startString: '<think>', endString: '</think>' }
  });

  for await (const chunk of p) {
    if (chunk.reasoningType) {
       console.log('[R]', JSON.stringify(chunk.content));
    } else {
       console.log('[C]', JSON.stringify(chunk.content));
    }
  }
}
main().catch(console.error);