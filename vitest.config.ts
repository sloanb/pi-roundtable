import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			thresholds: {
				lines: 90,
				branches: 80,
				functions: 90,
				statements: 90,
			},
			include: ["lib/**", "cli/**"],
			exclude: ["test/**", "**/*.test.*", "**/*.config.*"],
		},
	},
});
