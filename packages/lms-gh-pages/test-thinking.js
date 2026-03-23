const { LMStudioClient } = require('@lmstudio/sdk');

async function main() {
  const client = new LMStudioClient({ baseUrl: 'ws://192.168.1.207:1234' });
  const models = await client.llm.listLoaded();
  if (models.length === 0) { console.log('no models loaded'); return; }
  const model = models[0];
  console.log('Using model: ' + model.identifier);
  
  const process = model.respond([
    { role: 'user', content: 'whats the opposite of up' }
  ], {
    reasoningParsing: {
      enabled: true,
      startString: '<think>',
      endString: '</think>'
    }
  });

  for await (const chunk of process) {
    if (chunk.reasoningType === 'reasoning') {
      process.stdout.write('[R] ' + chunk.content);
    } else {
      process.stdout.write('[C] ' + chunk.content);
    }
  }
}
main().catch(console.error);