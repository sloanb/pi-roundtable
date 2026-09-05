# Orchestrator Protocol Documentation

This document describes the JSON-based communication protocol used between the Orchestrator and peer agents in pi-roundtable's orchestrated mode.

## Overview

In orchestrated mode, the Orchestrator peer coordinates the workflow by:

1. Routing tasks to appropriate peers based on their capabilities
2. Tracking workflow state (completed/pending/blocked tasks)
3. Detecting consensus and signaling completion
4. Handling fallbacks when routing fails

## Communication Flow

```
Orchestrator → Peer (instruction)
Peer → Orchestrator (structured report)
Orchestrator → Next Peer (instruction)
...
Orchestrator → [DONE] (consensus reached)
```

## Orchestrator Action Schema

The Orchestrator responds with a JSON object containing one of three actions:

### Route Action

Routes work to a specific peer.

```json
{
  "action": "route",
  "next_peer": "implementer",
  "instruction": "Implement the authentication module based on the design spec",
  "reason": "Design review complete, ready for implementation",
  "expected_output": "TypeScript implementation with tests",
  "state_update": {
    "completed_tasks": ["design-review"],
    "pending_tasks": ["implementation", "code-review", "commit"],
    "blocked_tasks": [],
    "artifacts": { "design-spec": "design.md" }
  }
}
```

**Required fields:**

- `action`: "route"
- `next_peer`: string (must match a peer name)
- `instruction`: string (specific task for the peer)
- `reason`: string (why this peer was chosen)
- `expected_output`: string (what the peer should produce)
- `state_update`: object (optional, updates workflow state)

### Done Action

Signals workflow completion with consensus.

```json
{
  "action": "done",
  "summary": "All tasks completed. Implementation reviewed and ready for release."
}
```

**Required fields:**

- `action`: "done"
- `summary`: string (final consensus summary)

### Fallback Action

Triggers fallback to sequential round-robin mode.

```json
{
  "action": "fallback",
  "reason": "Failed to parse peer response after 3 retries"
}
```

**Required fields:**

- `action`: "fallback"
- `reason`: string (why fallback is needed)

## Peer Report Schema

Each peer (except Orchestrator) must respond with a structured JSON report:

```json
{
  "status": "complete",
  "findings": "Implementation complete. All tests passing.",
  "artifacts": ["src/auth.ts", "tests/auth.test.ts"],
  "recommended_next_peer": "code-reviewer"
}
```

**Required fields:**

- `status`: "complete" | "needs_input" | "blocked" | "error"
- `findings`: string (summary of work done)
- `artifacts`: string[] (files created/modified)
- `recommended_next_peer`: string | null (suggested next peer, or null if unknown)

**Status values:**

- `complete`: Task finished successfully
- `needs_input`: Requires clarification or additional information
- `blocked`: Cannot proceed due to external dependency
- `error`: Encountered an error during execution

## Orchestrator Instruction Format

When the Orchestrator routes to a peer, it sends an instruction containing:

1. **Context**: Full transcript so far
2. **Workflow State**: Current completed/pending/blocked tasks
3. **Peer Capabilities**: Available peers and their capabilities
4. **Specific Instruction**: What this peer should do
5. **Expected Output**: What the Orchestrator expects back

Example instruction sent to a peer:

```
You are the Implementer. The topic is:

Build a user authentication system

Available peers and their capabilities:
{
  "researcher": ["research", "fact-check", "prior-art", "web-search"],
  "critic": ["review", "security-audit", "code-quality"],
  "implementer": ["implementation", "testing", "refactoring"],
  "code-reviewer": ["code-review", "security-audit"],
  "committer": ["git-operations", "release-management"]
}

Current workflow state:
{
  "completed_tasks": ["research", "design"],
  "pending_tasks": ["implementation", "code-review", "commit"],
  "blocked_tasks": [],
  "artifacts": { "design-spec": "design.md" }
}

Your instruction: Implement the authentication module based on the design spec in design.md. Focus on JWT-based auth with refresh tokens.

Expected output: TypeScript implementation with unit tests.

You MUST respond with a JSON object in this format:
{
  "status": "complete|needs_input|blocked|error",
  "findings": "string",
  "artifacts": ["string"],
  "recommended_next_peer": "string|null"
}
```

## Workflow State

The Orchestrator maintains workflow state:

```json
{
  "completed_tasks": ["task1", "task2"],
  "pending_tasks": ["task3", "task4"],
  "blocked_tasks": [],
  "artifacts": { "key": "value" },
  "visit_counts": { "peer_name": 3 },
  "last_peer": "peer_name",
  "consecutive_routes": 0
}
```

## Routing Rules & Guards

1. **Max Consecutive Routes**: Maximum 3 consecutive routes to the same peer before forcing rotation
2. **Max Visits Per Peer**: Configurable limit (default: 10) to prevent infinite loops
3. **Max Total Turns**: Configurable limit (default: 50) for the entire workflow
4. **Fallback Trigger**: If Orchestrator fails to produce valid JSON 3 times, falls back to sequential mode

## Peer Capabilities Reference

Each peer declares capabilities in their markdown frontmatter:

| Peer | Capabilities |
| ------ | ------------- |
| researcher | research, fact-check, prior-art, web-search |
| critic | review, security-audit, code-quality |
| implementer | implementation, testing, refactoring |
| developer | implementation, testing, debugging |
| code-reviewer | code-review, security-audit |
| committer | git-operations, release-management |
| releaser | versioning, changelog, publishing |
| orchestrator | orchestration, routing, consensus-detection, workflow-management |

## Integration Guide

For external consumers wanting to implement custom peers or extend the protocol:

1. **Peer Implementation**: Ensure your agent can parse the instruction format and respond with the Peer Report schema
2. **Capabilities**: Declare capabilities in your peer's frontmatter for Orchestrator awareness
3. **State Updates**: Include `state_update` in route actions to keep workflow state synchronized
4. **Error Handling**: Use `status: "error"` with descriptive findings when things go wrong

## Version History

- v1.0 (pi-roundtable 0.3.0): Initial protocol specification
