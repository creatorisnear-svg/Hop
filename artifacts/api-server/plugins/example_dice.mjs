// Example plugin shipped with the brain. Demonstrates how to add a new tool.
// Feel free to delete this file or copy it as a starting point.
export default function setup({ registerTool }) {
  registerTool({
    name: "roll_dice",
    description: "Roll N dice with S sides each. Useful for stochastic decisions.",
    paramsSchema: {
      type: "object",
      properties: {
        n: { type: "integer", minimum: 1, maximum: 20, default: 1 },
        sides: { type: "integer", minimum: 2, maximum: 1000, default: 6 },
      },
    },
    async run(params) {
      const n = Math.max(1, Math.min(20, Number(params?.n) || 1));
      const sides = Math.max(2, Math.min(1000, Number(params?.sides) || 6));
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      return { n, sides, rolls, total: rolls.reduce((a, b) => a + b, 0) };
    },
  });
}
