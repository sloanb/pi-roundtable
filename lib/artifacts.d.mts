/**
 * Render structured artifact values as human-readable Markdown.
 * See artifacts.mjs for the format rules.
 */

/**
 * True when a value should be rendered as a structured Markdown doc
 * (object or array) rather than treated as a flat string artifact.
 */
export declare function isStructuredArtifact(value: unknown): boolean;

/**
 * Render an artifact value as human-readable Markdown, headed with its
 * name:
 *   string → verbatim pass-through (a deliberate JSON string stays raw);
 *   number/boolean → inline scalar bullet;
 *   scalar array → bullet list;
 *   array of objects → Markdown table (union of keys, capped rows);
 *   object → "#### name" + key/value bullets (nested values as json blocks);
 *   anything else → fenced json block.
 * Returns null for empty/nullish values.
 */
export declare function artifactToMarkdown(
 name: string,
 value: unknown,
): string | null;
