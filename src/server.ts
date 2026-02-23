import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
    streamText,
    convertToModelMessages,
    tool,
    stepCountIs,
    wrapLanguageModel,
} from "ai";
import type { StreamTextOnFinishCallback, ToolSet } from "ai";
import { z } from "zod";

interface Env {
    AI: Ai;
    ChatAgent: DurableObjectNamespace;
    ASSETS: Fetcher;
}

export class ChatAgent extends AIChatAgent<Env> {
    private async _scheduleReminder(message: string, delaySeconds: number) {
        await this.schedule(delaySeconds, "onTask", { message });
        return { scheduled: true, message, inSeconds: delaySeconds };
    }

    async onTask(data: unknown) {
        const { message } = data as { message: string };
        const currentState = (this.state as Record<string, unknown>) ?? {};
        const reminders: string[] = Array.isArray(
            (currentState as { reminders?: string[] }).reminders
        )
            ? (currentState as { reminders: string[] }).reminders
            : [];
        reminders.push(`⏰ Reminder: ${message} (triggered at ${new Date().toISOString()})`);
        this.setState({ ...currentState, reminders });
    }

    async onChatMessage(onFinish: StreamTextOnFinishCallback<ToolSet>) {
        const workersai = createWorkersAI({ binding: this.env.AI });

        const stateObj = (this.state as Record<string, unknown>) ?? {};
        const pendingReminders: string[] = Array.isArray(
            (stateObj as { reminders?: string[] }).reminders
        )
            ? (stateObj as { reminders: string[] }).reminders
            : [];

        let systemPrompt = `You are Sage, a brilliant and friendly AI research assistant running on Cloudflare's global network.
You can search the web for current information, learn about the user's browser context, and schedule reminders.
Be concise, insightful, and always reference your tools when relevant.
Format responses with clear structure using markdown when helpful.
Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

        if (pendingReminders.length > 0) {
            systemPrompt += `\n\n--- ACTIVE REMINDERS ---\n${pendingReminders.join("\n")}\n--- END REMINDERS ---\nInform the user about these reminders.`;
            this.setState({ ...stateObj, reminders: [] });
        }

        const model = wrapLanguageModel({
            model: workersai("@cf/meta/llama-3.1-8b-instruct"),
            middleware: {
                specificationVersion: "v3" as const,
                wrapGenerate: async ({ doGenerate, params }: any) => {
                    if (params.tools) {
                        params.tools = params.tools.map((t: any) => ({ ...t, type: "function" as const }));
                    }
                    return doGenerate(params);
                },
                wrapStream: async ({ doStream, params }: any) => {
                    if (params.tools) {
                        params.tools = params.tools.map((t: any) => ({ ...t, type: "function" as const }));
                    }
                    return doStream(params);
                },
            },
        });

        const result = streamText({
            model,
            system: systemPrompt,
            messages: await convertToModelMessages(this.messages),
            tools: {
                searchWeb: tool({
                    description:
                        "Search the web for current information on any topic. Returns a concise summary of results.",
                    inputSchema: z.object({
                        query: z.string().describe("The search query"),
                    }),
                    execute: async ({ query }) => {
                        try {
                            const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
                            const res = await fetch(url);
                            const data = (await res.json()) as {
                                AbstractText: string;
                                AbstractURL: string;
                                RelatedTopics: Array<{ Text?: string; FirstURL?: string }>;
                            };

                            const abstract = data.AbstractText
                                ? data.AbstractText.slice(0, 500)
                                : null;

                            const related = data.RelatedTopics
                                ? data.RelatedTopics.filter((t) => t.Text)
                                    .slice(0, 4)
                                    .map((t) => ({ title: t.Text?.slice(0, 120), url: t.FirstURL }))
                                : [];

                            if (!abstract && related.length === 0) {
                                return {
                                    query,
                                    summary: `No instant answer found for "${query}". Suggest trying a more specific query.`,
                                    results: [],
                                };
                            }

                            return {
                                query,
                                summary: abstract ?? "See related results below.",
                                results: related,
                            };
                        } catch {
                            return {
                                query,
                                summary: "Search temporarily unavailable.",
                                results: [],
                            };
                        }
                    },
                }),

                getUserInfo: tool({
                    description:
                        "Get the user's browser information: timezone, locale, and local time. Runs in the user's browser.",
                    inputSchema: z.object({}),
                }),

                setReminder: tool({
                    description:
                        "Schedule a reminder for the user at a specified delay. Requires user approval before it is set.",
                    inputSchema: z.object({
                        message: z
                            .string()
                            .describe("The reminder message to show the user"),
                        delaySeconds: z
                            .number()
                            .int()
                            .positive()
                            .describe("How many seconds from now to trigger the reminder"),
                    }),
                    needsApproval: async () => true,
                    execute: async ({ message, delaySeconds }) => {
                        return await this._scheduleReminder(message, delaySeconds);
                    },
                }),
            },
            onFinish,
            stopWhen: stepCountIs(5),
        });

        return result.toUIMessageStreamResponse();
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const agentResponse = await routeAgentRequest(request, env);
        if (agentResponse) return agentResponse;

        if (env.ASSETS) {
            return env.ASSETS.fetch(request);
        }

        return new Response(
            `<!DOCTYPE html><html><body><h1>Sage Agent</h1><p>Assets not configured.</p></body></html>`,
            { headers: { "Content-Type": "text/html" } }
        );
    },
} satisfies ExportedHandler<Env>;
