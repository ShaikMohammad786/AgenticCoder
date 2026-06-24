---
name: Optimize Performance
description: Find and fix performance bottlenecks
mode: BUILD
---

Analyze this project for performance issues:

1. **Bundle size** — Check for unnecessary dependencies, tree-shaking opportunities
2. **Runtime performance** — N+1 queries, memory leaks, unnecessary re-renders
3. **Async operations** — Missing error handling, uncontrolled parallelism, race conditions
4. **Caching** — Missing memoization, redundant computations, cache invalidation issues

For each issue:
- Show the exact file and line number
- Explain the impact (latency, memory, CPU)
- Provide a working fix

Start by scanning the project structure, then focus on hot paths and critical modules.
