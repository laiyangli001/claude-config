import fs from "node:fs/promises";
import process from "node:process";

import { encoding_for_model, get_encoding } from "tiktoken";

const DEFAULT_ENCODING = "o200k_base";
const DEFAULT_MODE = "local";
const DEFAULT_REMOTE_MEASURE = "input";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_USAGE_MAX_OUTPUT_TOKENS = 1;

function printUsage() {
  console.log(`Usage:
  npm run count-tokens -- --mode local [--model <model> | --encoding <encoding>] [--file <path> | --text <text> | stdin] [--json]
  npm run count-tokens -- --mode remote --measure input --model <model> [--file <path> | --text <text> | stdin] [--api-key <key>] [--base-url <url>] [--json]
  npm run count-tokens -- --mode remote --measure usage --model <model> [--file <path> | --text <text> | stdin] [--api-key <key>] [--base-url <url>] [--max-output-tokens <n>] [--json]

Examples:
  npm run count-tokens -- --model gpt-4o-mini --text "Hello world"
  npm run count-tokens -- --mode remote --measure input --model gpt-4.1 --file prompt.txt
  Get-Content prompt.txt | npm run count-tokens -- --mode remote --measure usage --model gpt-4.1
  npm run count-tokens -- --mode remote --measure input --model gpt-4.1 --text "Hello world" --json

Environment:
  OPENAI_API_KEY   Required for --mode remote unless --api-key is provided
  OPENAI_BASE_URL  Optional, defaults to https://api.openai.com/v1`);
}

function parseArgs(argv) {
  const options = {
    json: false,
    mode: DEFAULT_MODE,
    measure: DEFAULT_REMOTE_MEASURE,
    maxOutputTokens: DEFAULT_USAGE_MAX_OUTPUT_TOKENS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (
      arg === "--mode" ||
      arg === "--measure" ||
      arg === "--model" ||
      arg === "--encoding" ||
      arg === "--file" ||
      arg === "--text" ||
      arg === "--api-key" ||
      arg === "--base-url" ||
      arg === "--max-output-tokens"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }

      if (arg === "--mode") {
        options.mode = value;
      } else if (arg === "--measure") {
        options.measure = value;
      } else if (arg === "--model") {
        options.model = value;
      } else if (arg === "--encoding") {
        options.encoding = value;
      } else if (arg === "--file") {
        options.file = value;
      } else if (arg === "--text") {
        options.text = value;
      } else if (arg === "--api-key") {
        options.apiKey = value;
      } else if (arg === "--base-url") {
        options.baseUrl = value;
      } else if (arg === "--max-output-tokens") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--max-output-tokens must be a positive integer");
        }
        options.maxOutputTokens = parsed;
      }

      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveInput(options) {
  if (options.file) {
    return fs.readFile(options.file, "utf8");
  }

  if (typeof options.text === "string") {
    return options.text;
  }

  if (!process.stdin.isTTY) {
    return readStdin();
  }

  throw new Error("No input provided. Use --file, --text, or pipe text through stdin.");
}

function normalizeMode(options) {
  if (!["local", "remote"].includes(options.mode)) {
    throw new Error("--mode must be either local or remote");
  }

  if (options.mode === "remote" && !["input", "usage"].includes(options.measure)) {
    throw new Error("--measure must be either input or usage when --mode remote is used");
  }
}

function resolveLocalTokenizer(options) {
  if (options.model) {
    return {
      tokenizer: encoding_for_model(options.model),
      model: options.model,
      encoding: null,
    };
  }

  if (options.encoding) {
    return {
      tokenizer: get_encoding(options.encoding),
      model: null,
      encoding: options.encoding,
    };
  }

  return {
    tokenizer: get_encoding(DEFAULT_ENCODING),
    model: null,
    encoding: DEFAULT_ENCODING,
  };
}

function getRemoteConfig(options) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const baseUrl = (options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("Remote mode requires OPENAI_API_KEY or --api-key");
  }

  if (!options.model) {
    throw new Error("Remote mode requires --model");
  }

  return { apiKey, baseUrl };
}

async function callOpenAIJson(path, payload, options) {
  const { apiKey, baseUrl } = getRemoteConfig(options);
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let json;

  try {
    json = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`OpenAI returned a non-JSON response (${response.status}): ${responseText}`);
  }

  if (!response.ok) {
    const message = json?.error?.message ?? JSON.stringify(json);
    throw new Error(`OpenAI API error ${response.status}: ${message}`);
  }

  return json;
}

async function countRemoteInputTokens(text, options) {
  const raw = await callOpenAIJson(
    "/responses/input_tokens",
    {
      model: options.model,
      input: text,
    },
    options,
  );

  const inputTokens =
    raw.input_tokens ??
    raw.total_tokens ??
    raw.count ??
    raw.usage?.input_tokens ??
    raw.usage?.prompt_tokens ??
    null;

  return {
    mode: "remote",
    measure: "input",
    model: raw.model ?? options.model,
    characters: text.length,
    input_tokens: inputTokens,
    raw,
  };
}

async function readRemoteUsage(text, options) {
  const raw = await callOpenAIJson(
    "/responses",
    {
      model: options.model,
      input: text,
      max_output_tokens: options.maxOutputTokens,
    },
    options,
  );

  return {
    mode: "remote",
    measure: "usage",
    response_id: raw.id ?? null,
    model: raw.model ?? options.model,
    characters: text.length,
    input_tokens: raw.usage?.input_tokens ?? null,
    output_tokens: raw.usage?.output_tokens ?? null,
    total_tokens: raw.usage?.total_tokens ?? null,
    cached_tokens: raw.usage?.input_tokens_details?.cached_tokens ?? null,
    reasoning_tokens: raw.usage?.output_tokens_details?.reasoning_tokens ?? null,
    raw,
  };
}

function formatLocalResult(result) {
  if (result.model) {
    console.log(`Model: ${result.model}`);
  }
  console.log(`Encoding: ${result.encoding}`);
  console.log(`Characters: ${result.characters}`);
  console.log(`Tokens: ${result.tokens}`);
}

function formatRemoteResult(result) {
  console.log(`Mode: ${result.mode}`);
  console.log(`Measure: ${result.measure}`);
  console.log(`Model: ${result.model}`);
  console.log(`Characters: ${result.characters}`);

  if (result.measure === "input") {
    console.log(`Input tokens: ${result.input_tokens ?? "unknown"}`);
    return;
  }

  if (result.response_id) {
    console.log(`Response ID: ${result.response_id}`);
  }
  console.log(`Input tokens: ${result.input_tokens ?? "unknown"}`);
  console.log(`Output tokens: ${result.output_tokens ?? "unknown"}`);
  console.log(`Total tokens: ${result.total_tokens ?? "unknown"}`);

  if (result.cached_tokens !== null) {
    console.log(`Cached tokens: ${result.cached_tokens}`);
  }
  if (result.reasoning_tokens !== null) {
    console.log(`Reasoning tokens: ${result.reasoning_tokens}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      printUsage();
      return;
    }

    normalizeMode(options);

    const text = await resolveInput(options);

    if (options.mode === "local") {
      const { tokenizer, model, encoding } = resolveLocalTokenizer(options);

      try {
        const tokenIds = tokenizer.encode(text);
        const result = {
          mode: "local",
          model,
          encoding: encoding ?? tokenizer.name ?? null,
          characters: text.length,
          tokens: tokenIds.length,
        };

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        formatLocalResult(result);
      } finally {
        tokenizer.free();
      }

      return;
    }

    const result =
      options.measure === "usage"
        ? await readRemoteUsage(text, options)
        : await countRemoteInputTokens(text, options);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    formatRemoteResult(result);
  } catch (error) {
    console.error(`Token count failed: ${error.message}`);
    console.error("Tips:");
    console.error("- Use --mode local for offline tiktoken estimation.");
    console.error("- Use --mode remote --measure input for OpenAI official preflight counting.");
    console.error("- Use --mode remote --measure usage to create a real response and read official usage.");
    process.exitCode = 1;
  }
}

await main();
