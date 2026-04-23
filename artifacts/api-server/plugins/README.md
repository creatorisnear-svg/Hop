# Plugins

Drop a `.mjs` (or `.js`) ES-module file into this directory and the brain will
load it on startup. Each plugin exports a default function that receives a
small API and registers one or more agent tools.

## Example

```js
// plugins/echo.mjs
export default function setup({ registerTool, logger }) {
  registerTool({
    name: "echo",
    description: "Returns whatever JSON you send it.",
    paramsSchema: { type: "object", additionalProperties: true },
    async run(params) {
      logger.info({ params }, "echo called");
      return params;
    },
  });
}
```

After dropping a file in here, restart the server (or open the Plugins UI and
hit "Reload"). New tools become visible to Jarvis on the very next run.

## API

The setup function gets:

- `registerTool(def)` — register a new tool. `def` is `{ name, description, paramsSchema, run(params) }`.
- `logger` — the shared pino logger.

That's it. Tools added by plugins behave exactly like the built-ins.
