# API Reference & Tool Schemas

This document defines the interface for internal tools and the communication protocol for Sage AI.

## Tool Definitions

### `searchWeb`
Searches the web for current information on any topic.
- **Source**: Server-side (via DuckDuckGo)
- **Parameters**: 
  - `query` (string): The search query.
- **Response**: A JSON object containing a summary and a list of related topics.

### `getUserInfo`
Retrieves browser-specific information like timezone and locale.
- **Source**: Client-side (Browser API)
- **Parameters**: None
- **Response**: 
  - `timezone` (string)
  - `locale` (string)
  - `localTime` (string)
  - `userAgent` (string)

### `setReminder`
Schedules a reminder for the user.
- **Source**: Server-side (Durable Object Alarms)
- **Parameters**:
  - `message` (string): The reminder text.
  - `delaySeconds` (number): Seconds from now until trigger.
- **Response**: Confirmation message with scheduled time.

## Communication Protocol

### Message Schema
All messages follow the standard AI Chat protocol:
```typescript
type WorkersAIMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }[];
};
```

### Stream Events
The agent communicates with the UI via server-sent events:
- `text-start`: Marks the beginning of a textual response.
- `text-delta`: Delivers response chunks in real-time.
- `tool-input-available`: Notifies the UI that a tool call is being prepared.
- `tool-output-available`: Delivers the results of a tool execution.

## Error Handling

| Code | Scenario | Resolution |
|------|----------|------------|
| 500  | Model Timeout | Automated retry with exponential backoff on client. |
| 429  | Rate Limit | User is notified to wait 10 seconds. |
| Tool Err | Invalid Params | Model is notified of the error and asked to re-attempt. |
