import Anthropic from "@anthropic-ai/sdk";
import { getAllBankData, getMetricsMeta, getAllPeriods } from "@/lib/data";
import { buildChatSystemPrompt, type ChatViewContext } from "@/lib/chat-context";
import { RENDER_CHART_TOOL, buildChartSpecFromToolInput } from "@/lib/chart-tool";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  context?: ChatViewContext;
}

const MAX_TOOL_ITERATIONS = 4;

const encoder = new TextEncoder();

function sseLine(type: "text" | "status" | "chart" | "error" | "done", value: string) {
  return encoder.encode(JSON.stringify({ t: type, v: value }) + "\n");
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(sseLine("error", "The chat assistant isn't configured yet — set ANTHROPIC_API_KEY in your environment."), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const body = (await request.json()) as ChatRequestBody;
  const history = (body.messages ?? []).slice(-20);
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return new Response("Bad request: last message must be from the user.", { status: 400 });
  }

  const [banks, metricsMeta] = await Promise.all([getAllBankData(), getMetricsMeta()]);
  const { instructions, groundingData } = buildChatSystemPrompt(banks, metricsMeta, body.context);
  const validPeriods = getAllPeriods(banks).map((p) => p.period);
  const validBankIds = banks.map((b) => b.bankId);

  const client = new Anthropic();

  const system = [
    { type: "text" as const, text: instructions },
    { type: "text" as const, text: `DATASET (JSON, all banks/quarters):\n${groundingData}`, cache_control: { type: "ephemeral" as const } },
  ];

  let activeStream: ReturnType<typeof client.messages.stream> | null = null;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let currentMessages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
          const stream = client.messages.stream({
            model: "claude-sonnet-5",
            max_tokens: 2048,
            thinking: { type: "adaptive" },
            system,
            tools: [{ type: "web_search_20260209", name: "web_search" }, RENDER_CHART_TOOL],
            messages: currentMessages,
          });
          activeStream = stream;

          for await (const event of stream) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "server_tool_use") {
                controller.enqueue(sseLine("status", "Searching the web..."));
              } else if (event.content_block.type === "tool_use" && event.content_block.name === "render_chart") {
                controller.enqueue(sseLine("status", "Preparing a chart..."));
              }
            }
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(sseLine("text", event.delta.text));
            }
          }

          const finalMessage = await stream.finalMessage();

          if (finalMessage.stop_reason === "pause_turn") {
            currentMessages = [...currentMessages, { role: "assistant", content: finalMessage.content }];
            continue;
          }

          if (finalMessage.stop_reason !== "tool_use") break;

          const toolUseBlocks = finalMessage.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );
          if (toolUseBlocks.length === 0) break;

          currentMessages = [...currentMessages, { role: "assistant", content: finalMessage.content }];

          const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => {
            if (block.name !== "render_chart") {
              return { type: "tool_result", tool_use_id: block.id, content: "Unknown tool.", is_error: true };
            }
            const spec = buildChartSpecFromToolInput(block.input, metricsMeta.metrics, validPeriods, validBankIds);
            if (!spec) {
              return {
                type: "tool_result",
                tool_use_id: block.id,
                content: "Could not render this chart — one or more parameters didn't match the dataset. Continue your answer in text, or retry with valid metric keys/bank ids/periods.",
                is_error: true,
              };
            }
            controller.enqueue(sseLine("chart", JSON.stringify(spec)));
            return { type: "tool_result", tool_use_id: block.id, content: "Chart rendered to the analyst successfully." };
          });

          currentMessages = [...currentMessages, { role: "user", content: toolResults }];
        }
      } catch (err) {
        const message = err instanceof Anthropic.APIError ? err.message : "The assistant hit an unexpected error. Please try again.";
        controller.enqueue(sseLine("error", message));
      } finally {
        controller.enqueue(sseLine("done", ""));
        controller.close();
      }
    },
    cancel() {
      activeStream?.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
