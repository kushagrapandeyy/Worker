import { z } from "zod";

type WorkersAIMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string;
    tool_call_id?: string;
    name?: string;
    tool_calls?: any[];
};

console.log("Ready to fix");
