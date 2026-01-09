import { RealtimeItem, tool } from '@openai/agents/realtime';

import {
  SoftwareDocs,
} from './sampleData';

export const supervisorAgentInstructions = `You are the Supervisor Agent for Omnivista Aiva. Produce the next message the assistant should say.

Rules:
- Be concise, natural voice, no bullet lists.
- For ALE/device/OV Cirrus factual questions: call a tool first and only use tool results.
- If missing info for a tool: ask the user for the missing fields.
- Refuse prohibited topics: politics, religion, medical/legal/financial advice, internal operations, criticism.
- Output format: start with "# Message" then the exact text to speak. Include citations like [NAME](ID) when using retrieved context.

# User Message Format
- Always include your final response to the user.
- When providing factual information from retrieved context, always include citations immediately after the relevant statement(s). Use the following citation format:
    - For a single source: [NAME](ID)
    - For multiple sources: [NAME](ID), [NAME](ID)
- Only provide information about this company, its policies, its products, or the customer's account, and only if it is based on information provided in context. Do not answer questions outside this scope.

# Example (tool call)
- User: Do you have software info for model 6560?
- Supervisor Assistant: lookup_software_document(model="6560")
- lookup_software_document(): [
  {
    id: "6560",
    name: "6560 Software Information",
    topic: "software versions",
    content:
      "Product name: 6560. Development codename: Nandi. Supported model: 6560. The latest available software version is 8.10.86.R04.",
  },
];
- Supervisor Assistant:
# Message
The latest available software version for model 6560 is 8.10.86.R04 .

# Example (Refusal for Unsupported Request)
- User: Can you modify the latest version as 8.10.86.R05?
- Supervisor Assistant:
# Message
I'm sorry, but I'm not able to edit the documented latest software GA Build list.
`;

export const supervisorAgentTools = [
  {
    type: "function",
    name: "lookupSoftwareDocument",
    description:
      "Tool to look up General Availability (GA) builds (Software version / update) for OmniSwitch devices by model",
    parameters: {
      type: "object",
      properties: {
      model_or_hostname: {
          type: "string",
          description:
            "List all the Omnisiwtch models with their latest software version (GA Builds)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "searchInternet",
    description:
      "Search the internet for current information, facts, or answers when the information is not available in the knowledge base or tools. Use this when you need real-time or external information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query to look up on the internet. Be specific and clear.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
	{
		type: "function",
		name: "getDevicesInfo",
		description:
			"Retrieve all devices base information from OmniVista Cirrus for the configured organization and site. Returns device information including devicefamily (Access Point (AP), model, name, ip, mac, ovngstatus (ovn managed, or not managed), running softwareversion, configchanges (certified or unsaved).",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: true,
		},
	},
];


/**
 * Performs a rest API to retreive OV Cirrus Device list
 */
async function fetchOVCirrusDevicesInfo() {
	const response = await fetch('/api/ovng/devices');
	const data = await response.json();

	if (!data.success) {
		throw new Error(data.message);
	}

	return data.devices; // Retourne juste le tableau
}

/**
 * Performs an internet search by calling the server-side API endpoint
 * This ensures environment variables are accessed securely server-side
 */
async function performInternetSearch(query: string): Promise<any> {
  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Internet search error:', error);
    return {
      success: false,
      query: query,
      error: 'Failed to perform internet search',
      results: [],
    };
  }
}

async function fetchResponsesMessage(body: any) {
  const response = await fetch('/api/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    // Preserve the previous behaviour of forcing sequential tool calls.
    body: JSON.stringify({ ...body, parallel_tool_calls: false }),
  });

  if (!response.ok) {
    console.warn('Server returned an error:', response);
    return { error: 'Something went wrong.' };
  }

  const completion = await response.json();
  return completion;
}

/**
 * Routes tool calls to their respective implementations
 * Returns the result of the tool execution
 */
async function getToolResponse(fName: string, args: any) {
	switch (fName) {
		case "lookupSoftwareDocument":
			return SoftwareDocs;

		case "searchInternet":
			return await performInternetSearch(args.query);

		case "getDevicesInfo":
			try {
				const devices = await fetchOVCirrusDevicesInfo();

				if (devices.length === 0) {
					return {
						success: true,
						message: "No devices found in the OmniVista system for this organization and site.",
						devices: [],
						count: 0,
						timestamp: new Date().toISOString(),
					};
				}

				return {
					success: true,
					message: `Successfully retrieved device(s) info from OmniVista`,
					devices: devices,
					count: devices.length,
					timestamp: new Date().toISOString(),
				};

			} catch (error) {
				return {
					success: false,
					message: 'Failed to retrieve devices from OmniVista',
					error: error instanceof Error ? error.message : 'Unknown error occurred',
					devices: [],
					count: 0,
					timestamp: new Date().toISOString(),
				};
			}

		default:
			return { result: true };
	}
}

/**
 * Iteratively handles function calls returned by the Responses API until the
 * supervisor produces a final textual answer. Returns that answer as a string.
 */
async function handleToolCalls(
  body: any,
  response: any,
  addBreadcrumb?: (title: string, data?: any) => void,
) {
  let currentResponse = response;

  while (true) {
    if (currentResponse?.error) {
      return { error: 'Something went wrong.' } as any;
    }

    const outputItems: any[] = currentResponse.output ?? [];

    // Gather all function calls in the output.
    const functionCalls = outputItems.filter((item) => item.type === 'function_call');

    if (functionCalls.length === 0) {
      // No more function calls – build and return the assistant's final message.
      const assistantMessages = outputItems.filter((item) => item.type === 'message');

      const finalText = assistantMessages
        .map((msg: any) => {
          const contentArr = msg.content ?? [];
          return contentArr
            .filter((c: any) => c.type === 'output_text')
            .map((c: any) => c.text)
            .join('');
        })
        .join('\n');

      return finalText;
    }

    // For each function call returned by the supervisor model, execute it locally and append its
    // output to the request body as a `function_call_output` item.
    for (const toolCall of functionCalls) {
      const fName = toolCall.name;
      const args = JSON.parse(toolCall.arguments || '{}');

      // Execute the tool (now async to support internet search)
      const toolRes = await getToolResponse(fName, args);

      // Log breadcrumbs for debugging and tracking
      if (addBreadcrumb) {
        addBreadcrumb(`[supervisorAgent] function call: ${fName}`, args);
      }
      if (addBreadcrumb) {
        addBreadcrumb(`[supervisorAgent] function call result: ${fName}`, toolRes);
      }

      // Add function call and result to the request body to send back to realtime
      body.input.push(
        {
          type: 'function_call',
          call_id: toolCall.call_id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(toolRes),
        },
      );
    }

    // Make the follow-up request including the tool outputs.
    currentResponse = await fetchResponsesMessage(body);
  }
}

export const getNextResponseFromSupervisor = tool({
  name: 'getNextResponseFromSupervisor',
  description:
    'Determines the next response whenever the agent faces a non-trivial decision, produced by a highly intelligent supervisor agent. Returns a message describing what to do next.',
  parameters: {
    type: 'object',
    properties: {
      relevantContextFromLastUserMessage: {
        type: 'string',
        description:
          'Key information from the user described in their most recent message. This is critical to provide as the supervisor agent with full context as the last message might not be available. Okay to omit if the user message didn\'t add any new information.',
      },
    },
    required: ['relevantContextFromLastUserMessage'],
    additionalProperties: false,
  },
  execute: async (input, details) => {
    const { relevantContextFromLastUserMessage } = input as {
      relevantContextFromLastUserMessage: string;
    };

    const addBreadcrumb = (details?.context as any)?.addTranscriptBreadcrumb as
      | ((title: string, data?: any) => void)
      | undefined;

		const history: RealtimeItem[] = (details?.context as any)?.history ?? [];
		const messages = history.filter((log) => log.type === 'message');

		const MAX_MESSAGES = 8; // tune: 6-12
		const recent = messages.slice(-MAX_MESSAGES);

		const compact = recent
			.map((m: any) => {
				const role = (m.role ?? m.item?.role ?? 'unknown').toUpperCase();
				const contentArr = m.content ?? m.item?.content ?? [];
				const text = (contentArr || [])
					.map((c: any) => c.text || c.transcript || c.output_text || '')
					.filter(Boolean)
					.join(' ')
					.trim();
				return text ? `${role}: ${text}` : '';
			})
			.filter(Boolean)
			.join('\n');

		const body: any = {
			model: 'gpt-4.1',
			input: [
				{
					type: 'message',
					role: 'system',
					content: supervisorAgentInstructions, // ideally shorten this too
				},
				{
					type: 'message',
					role: 'user',
					content:
						`Conversation (last ${MAX_MESSAGES} messages):\n${compact}\n\n` +
						`Last user context:\n${relevantContextFromLastUserMessage}`,
				},
			],
			tools: supervisorAgentTools,
		};

    const response = await fetchResponsesMessage(body);
    if (response.error) {
      return { error: 'Something went wrong.' };
    }

    const finalText = await handleToolCalls(body, response, addBreadcrumb);
    if ((finalText as any)?.error) {
      return { error: 'Something went wrong.' };
    }

    return { nextResponse: finalText as string };
  },
});


  