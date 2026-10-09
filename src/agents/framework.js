/**
 * Minimal agent framework for the SafeGlobe Compliance Agent.
 *
 * It follows the same shape as Google's Agent Development Kit (ADK) and LangChain so the
 * built-in runtime can later be swapped for either without changing the agent definition:
 *
 *   this file            Google ADK                 LangChain / LangGraph
 *   -------------------  -------------------------  ------------------------------
 *   Tool                 FunctionTool               DynamicStructuredTool
 *   Agent                LlmAgent                   AgentExecutor / graph node
 *   Agent.plan           SequentialAgent workflow   LangGraph edges
 *   Runner + Session     Runner + Session.state     RunnableConfig + checkpointer
 *   ModelAdapter         BaseLlm (Gemini)           BaseChatModel (ChatGoogleGenerativeAI)
 *
 * Two model adapters ship today:
 *   - GeminiModel       used when a Gemini API key works
 *   - PlaceholderModel  used when the key is missing, over quota or offline; the agent then
 *                       answers from its tools and deterministic templates only
 *
 * AGENT_RUNTIME=adk | langchain are reserved for those runtimes and currently fall back to
 * the built-in one (see resolveRuntime).
 */
const config = require('../config');
const gemini = require('../services/geminiClient');

class Tool {
  constructor({ name, description, parameters = {}, run }) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.run = run;
  }
  describe() {
    return { name: this.name, description: this.description, parameters: this.parameters };
  }
}

class PlaceholderModel {
  constructor() { this.name = 'placeholder'; this.mode = 'placeholder'; }
  async generateJson() { return null; }
}

class GeminiModel {
  constructor() { this.name = config.geminiModel; this.mode = 'gemini'; }
  async generateJson(prompt, { systemInstruction } = {}) {
    const out = await gemini.generateJsonDetailed(prompt, { systemInstruction, temperature: 0.2, timeoutMs: 20000 });
    if (!out) return null;
    this.name = out.model;
    return out.data;
  }
}

function resolveModel() {
  return gemini.isConfigured() ? new GeminiModel() : new PlaceholderModel();
}

// PLACEHOLDER: external agent runtimes. Implement by translating Agent/Tool definitions into
// @google/adk (LlmAgent + FunctionTool + Runner) or LangChain (createToolCallingAgent) objects.
function resolveRuntime() {
  const wanted = String(config.agentRuntime || 'builtin').toLowerCase();
  if (wanted !== 'builtin') {
    console.warn(`[Compliance Agent] AGENT_RUNTIME=${wanted} is not implemented yet; using the built-in runtime.`);
  }
  return 'builtin';
}

class Session {
  constructor(state = {}) {
    this.state = state;
    this.events = [];
  }
}

/**
 * An agent is a set of instructions, the tools it may call, and a plan that calls them.
 *   plan(input, ctx)       -> gathers evidence with ctx.call(toolName, args), returns a draft result
 *   synthesize(draft, ctx) -> optional LLM step (ctx.llm) that explains / refines the draft
 */
class Agent {
  constructor({ name, description, instruction, tools = [], plan, synthesize }) {
    this.name = name;
    this.description = description;
    this.instruction = instruction;
    this.tools = new Map(tools.map(t => [t.name, t]));
    this.plan = plan;
    this.synthesize = synthesize;
  }
  describe() {
    return { name: this.name, description: this.description, instruction: this.instruction, tools: [...this.tools.values()].map(t => t.describe()) };
  }
}

const summarise = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text && text.length > 220 ? `${text.slice(0, 217)}...` : text;
};

class Runner {
  /**
   * @param {{ useModel?: boolean }} options  useModel=false forces placeholder mode (no LLM call)
   */
  static async run(agent, input, { session = new Session(), useModel = true } = {}) {
    resolveRuntime();
    const model = useModel ? resolveModel() : new PlaceholderModel();
    const started = Date.now();

    const ctx = {
      session,
      model,
      async call(toolName, args = {}, note = '') {
        const tool = agent.tools.get(toolName);
        if (!tool) throw new Error(`${agent.name} has no tool named ${toolName}`);
        const t0 = Date.now();
        let output;
        let error = null;
        try {
          output = await tool.run(args, ctx);
        } catch (err) {
          error = err.message;
          output = null;
        }
        session.events.push({
          agent: agent.name,
          tool: tool.name,
          note: note || tool.description,
          input: summarise(args),
          output: error ? `error: ${error}` : summarise(output && output.summary ? output.summary : output),
          ms: Date.now() - t0
        });
        return output;
      },
      async llm(prompt) {
        const data = await model.generateJson(prompt, { systemInstruction: agent.instruction });
        session.events.push({
          agent: agent.name,
          tool: 'model',
          note: data ? `Reasoning by ${model.name}` : 'No model available: placeholder reasoning used',
          input: summarise(prompt.slice(0, 160)),
          output: data ? summarise(data) : 'placeholder',
          ms: 0
        });
        return data;
      }
    };

    let result = await agent.plan(input, ctx);
    if (agent.synthesize) {
      const refined = await agent.synthesize(result, ctx, input);
      if (refined) result = refined;
    }

    // Reasoning counts as "gemini" only if the model actually answered
    const reasoned = session.events.some(e => e.tool === 'model' && e.output !== 'placeholder');
    return Object.assign(result, {
      agent: agent.name,
      mode: reasoned ? 'gemini' : 'placeholder',
      model: reasoned ? model.name : 'deterministic placeholder (no API key / quota)',
      ran_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      trace: session.events
    });
  }
}

module.exports = { Tool, Agent, Runner, Session, PlaceholderModel, GeminiModel, resolveModel, resolveRuntime };
