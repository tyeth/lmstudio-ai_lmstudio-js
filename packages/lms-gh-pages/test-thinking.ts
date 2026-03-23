import { LMStudioClient } from '@lmstudio/sdk';

async function main() {
  const client = new LMStudioClient({ baseUrl: 'ws://192.168.1.207:1234' });
  const models = await client.llm.listLoaded();
  if (models.length === 0) { console.log('no models loaded'); return; }
  const model = models[0];
  console.log('Using model: ' + model.identifier);
  
  const prediction = model.respond([
    { role: 'user', content: 'whats the opposite of up' }
  ], {
    reasoningParsing: {
      enabled: true,
      startString: '<think>',
      endString: '</think>'
    }
  });

  for await (const chunk of prediction) {
    if (chunk.reasoningType === 'reasoning') {
      global.process.stdout.write('[R] ' + chunk.content);
    } else {
      global.process.stdout.write('[C] ' + chunk.content);
    }
  }
}
main().catch(console.error);