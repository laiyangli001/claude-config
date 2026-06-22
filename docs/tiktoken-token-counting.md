# Token Counting

This workspace includes a token counting command with two modes:

- `local`: offline counting with OpenAI's official `tiktoken` library
- `remote`: official server-side counting and usage reading through the OpenAI API

## Install

```bash
npm install
```

## Local Mode

Count inline text with a specific model:

```bash
npm run count-tokens -- --mode local --model gpt-4o-mini --text "Hello world"
```

Count tokens from a file:

```bash
npm run count-tokens -- --mode local --model gpt-4.1 --file prompt.txt
```

Count tokens from stdin:

```bash
Get-Content prompt.txt | npm run count-tokens -- --mode local --model gpt-4.1
```

Return JSON:

```bash
npm run count-tokens -- --mode local --encoding o200k_base --text "官方Token计算库" --json
```

## Remote Mode

Set your API key first:

```powershell
$env:OPENAI_API_KEY = "sk-..."
```

Official preflight input token counting with OpenAI:

```bash
npm run count-tokens -- --mode remote --measure input --model gpt-4.1 --text "Hello world"
```

Official usage reading from a real response:

```bash
npm run count-tokens -- --mode remote --measure usage --model gpt-4.1 --text "Hello world"
```

Read from a file and return JSON:

```bash
npm run count-tokens -- --mode remote --measure input --model gpt-4.1 --file prompt.txt --json
```

Use a custom base URL if needed:

```bash
npm run count-tokens -- --mode remote --measure input --model gpt-4.1 --text "Hello world" --base-url https://api.openai.com/v1
```

## Notes

- Prefer `--mode remote --measure input` when you want OpenAI's official server-side count before sending a real generation request.
- Use `--mode remote --measure usage` only when you want the response's official `usage` fields. It creates a real model call and may incur cost.
- Prefer `--model` over `--encoding` when you care about model-specific tokenization.
- `OPENAI_API_KEY` is required for remote mode unless you pass `--api-key`.
