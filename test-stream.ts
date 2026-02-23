import { Ai } from "@cloudflare/ai";
export default {
  async fetch(request, env) {
    if (request.url.includes('/test')) {
      const stream = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: "What timezone am I in? Call the getUserInfo tool." }],
        tools: [{ type: "function", function: { name: "getUserInfo", description: "Get the user's browser timezone", parameters: { type: "object", properties: {} } } }],
        stream: true
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response("OK");
  }
}
