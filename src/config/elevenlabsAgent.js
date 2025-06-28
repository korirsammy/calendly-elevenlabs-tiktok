const systemPrompt = require('./prompts/systemPrompt');
const config = require('./environment'); // ✅ import config to access env variables

function createAgentConfig(options) {
  const { agentName, serverUrl, calendlyEvents } = options;

  return {
    name: agentName || "Calendly Booking Assistant",
    description: "A voice assistant that helps users book calendar appointments via Calendly.",
    system_prompt: systemPrompt,
    voices: [
      {
        voice_id: "EXAVITQu4vr4xnSDxMaL",
        name: "Rachel"
      }
    ],
    functions: [
      {
        name: "checkAvailability",
        description: "Gets a weekly overview of available days",
        parameters: {
          type: "object",
          properties: {
            weekOffset: {
              type: "integer",
              description: "Week offset from current week (0 = current week, 1 = next week)"
            },
            eventTypeUrl: {
              type: "string",
              description: "Calendly event type URL",
              enum: calendlyEvents?.map(e => e.id) || []
            }
          },
          required: ["eventTypeUrl"]
        }
      },
      {
        name: "checkTimes",
        description: "Gets specific time slots for a selected day",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format"
            },
            eventTypeUrl: {
              type: "string",
              description: "Calendly event type URL",
              enum: calendlyEvents?.map(e => e.id) || []
            },
            period: {
              type: "string",
              enum: ["morning", "afternoon"],
              description: "Time of day preference"
            }
          },
          required: ["date", "eventTypeUrl"]
        }
      },
      {
        name: "sendBookingSMS",
        description: "Sends an SMS with booking confirmation and link",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Customer name"
            },
            eventTime: {
              type: "string",
              description: "Formatted event time (e.g., 'Wednesday, May 15 at 2:30 PM')"
            },
            eventDuration: {
              type: "string",
              description: "Duration of the event (e.g., '30')"
            },
            schedulingUrl: {
              type: "string",
              description: "Calendly scheduling URL to complete the booking"
            }
          },
          required: ["name", "eventTime", "eventDuration", "schedulingUrl"]
        }
      }
    ],
    webhooks: [
      {
        url: `${serverUrl}/api/elevenlabs/personalization`,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.apiKey // ✅ Use actual API key from env
        },
        context_variables: ["current_date", "current_time", "caller_number"]
      }
    ],
    function_webhooks: [
      {
        url: `${serverUrl}/api/elevenlabs/function-handler`,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.apiKey // ✅ Use actual API key from env
        }
      }
    ]
  };
}

module.exports = {
  createAgentConfig
};
