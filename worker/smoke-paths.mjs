import { DatabaseSync } from "node:sqlite";
import { createNodeSqliteAdapter } from "./src/adapters/node-sqlite-adapter.mjs";
import { getNarratorPaths, MAX_EDGES_HARD_LIMIT, MAX_DEPTH_HARD_LIMIT } from "./src/core/graph-traversal.mjs";

const raw = new DatabaseSync(new URL("./atlas.db", import.meta.url).pathname, { readOnly: true });
const db = createNodeSqliteAdapter(raw);
console.log("hard limits", MAX_DEPTH_HARD_LIMIT, MAX_EDGES_HARD_LIMIT);

const r = await getNarratorPaths(db, "v1", "UNC-3c5a02862689", { direction: "transmitted_from", maxDepth: 4 });
console.log("edges:", r.data.edges.length, "nodes:", r.data.nodes.length, "truncated:", r.data.truncated);

const r2 = await getNarratorPaths(db, "v1", "UNC-3c5a02862689", { direction: "transmitted_from", maxDepth: 20 });
console.log("depth-req-20 clamped maxDepth:", r2.data.maxDepth, "edges:", r2.data.edges.length, "truncated:", r2.data.truncated);

const depths = r.data.edges.map((e) => e.depth);
console.log("observed max depth in edges (should be <= 4):", Math.max(...depths));

// cycle safety: query a small, likely-cyclic-free narrow example and check for duplicate source>target pairs at same depth chain
const r3 = await getNarratorPaths(db, "v1", "UNC-3c5a02862689", { direction: "transmitted_to", maxDepth: 8 });
console.log("transmitted_to depth8 edges:", r3.data.edges.length, "truncated:", r3.data.truncated);

// unknown node -> empty result, not an error
const r4 = await getNarratorPaths(db, "v1", "UNC-doesnotexist000000", { direction: "transmitted_from", maxDepth: 8 });
console.log("unknown node edges:", r4.data.edges.length, "nodes:", r4.data.nodes.length);
