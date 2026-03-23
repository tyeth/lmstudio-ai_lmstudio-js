import { LMStudioClient, tool } from '@lmstudio/sdk';
import { z } from 'zod';

async function main() {
  const client = new LMStudioClient({ baseUrl: 'ws://172.20.192.1:1234' });
  const model = await client.llm.model();
  
  const get_opposite_word = tool({
    name: 'get_opposite_word',
    description: 'Calculates the exact opposite of any directional or descriptive word.',
    parameters: {
      word: z.string().describe('The word to find the opposite for'),
    },
    implementation: async ({ word }) => {
      console.log('\n--> [TOOL EXECUTED]: get_opposite_word(' + word + ')');
      if (word.toLowerCase() === 'up') return 'down';
      return 'unknown';
    }
  });

  console.log('Sending request to model.act()...');
  const result = await model.act('What is the opposite of up?', [get_opposite_word], {
    onMessage: (msg) => {
      console.log('Stream chunk:', msg);
    }
  });
  console.log('\nFinal content:', result.content);
}

main().catch(console.error);
