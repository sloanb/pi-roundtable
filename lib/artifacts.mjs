/**
 * artifacts.mjs — render structured artifact values as human-readable
 * Markdown.
 *
 * Orchestrator conclusions carry `final_artifacts`, and workflow state
 * carries artifacts, whose values may be structured (objects/arrays), not
 * just file paths. Rendering them with String() produces
 * "[object Object]" garbage; this module turns structures into readable
 * Markdown instead:
 *
 *   string            → passed through VERBATIM (the deliberate escape
 *                       hatch: emit a JSON string as the artifact value to
 *                       keep it raw — no knobs needed)
 *   number/boolean    → inline scalar
 *   array of scalars  → bullet list
 *   array of objects  → Markdown table (union of keys as columns)
 *   object            → "#### name" + key/value bullets (nested values as
 *                       fenced json blocks)
 *   anything else     → fenced json block
 */

const TABLE_ROW_CAP = 25;
const CELL_MAX = 120;

const isPlainObject = (v) =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** True when a value should be rendered as a structured Markdown doc
 *  rather than treated as a flat string artifact. */
export function isStructuredArtifact(value) {
	return typeof value === "object" && value !== null;
}

/** Flatten a table/bullet cell to one readable line. */
function cellText(value) {
	let s;
	if (value === null || value === undefined) s = "";
	else if (typeof value === "string") s = value;
	else if (typeof value === "number" || typeof value === "boolean") {
		s = String(value);
	} else if (isPlainObject(value)) {
		s = Object.entries(value)
			.map(
				([k, v]) =>
					`${k}: ${typeof v === "object" && v !== null ? "…" : String(v)}`,
			)
			.join("; ");
	} else {
		s = JSON.stringify(value) ?? "";
	}
	s = s.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
	if (s.length > CELL_MAX) s = `${s.slice(0, CELL_MAX - 1)}…`;
	return s;
}

/**
 * Render an artifact value as human-readable Markdown, headed with its
 * name. Returns null for empty/nullish values (nothing to show).
 */
export function artifactToMarkdown(name, value) {
	if (value === null || value === undefined) return null;

	// Strings pass through verbatim — the "unless specifically requested
	// different" escape: a deliberately-raw JSON string stays raw.
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed === "" ? null : value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return `- **${name}:** ${String(value)}`;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return null;
		const allObjects = value.every(isPlainObject);
		if (allObjects) {
			// Union of keys across rows, first-seen order.
			const columns = [];
			for (const row of value) {
				for (const k of Object.keys(row)) {
					if (!columns.includes(k)) columns.push(k);
				}
			}
			const header = `| ${columns.join(" | ")} |`;
			const sep = `|${columns.map(() => " --- ").join("|")}|`;
			const rows = value
				.slice(0, TABLE_ROW_CAP)
				.map((row) => `| ${columns.map((c) => cellText(row[c])).join(" | ")} |`);
			let table = [header, sep, ...rows].join("\n");
			if (value.length > TABLE_ROW_CAP) {
				table += `\n\n… +${value.length - TABLE_ROW_CAP} more rows`;
			}
			return `#### ${name}\n\n${table}`;
		}
		// Mixed / scalar array → bullet list.
		const bullets = value
			.slice(0, TABLE_ROW_CAP)
			.map((item) => `- ${cellText(item)}`);
		let list = bullets.join("\n");
		if (value.length > TABLE_ROW_CAP) {
			list += `\n\n… +${value.length - TABLE_ROW_CAP} more items`;
		}
		return `#### ${name}\n\n${list}`;
	}

	if (isPlainObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) return null;
		const lines = entries.map(([k, v]) => {
			if (
				typeof v === "string" ||
				typeof v === "number" ||
				typeof v === "boolean" ||
				v === null
			) {
				return `- **${k}:** ${cellText(v)}`;
			}
			// Nested structure → fenced json block (indented under the bullet).
			const json = JSON.stringify(v, null, 2).replace(/\r?\n/g, "\n  ");
			return `- **${k}:**\n\n  \`\`\`json\n  ${json}\n  \`\`\``;
		});
		return `#### ${name}\n\n${lines.join("\n")}`;
	}

	// Anything else: fenced json block.
	return `#### ${name}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}
