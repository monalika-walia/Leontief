/**
 * Serialize a JSON-LD graph for embedding in <script type="application/ld+json">.
 * `<` is escaped so a value containing "</script>" cannot close the element early.
 */
export function ldjson(...nodes: unknown[]): string {
  const graph = nodes.length === 1 ? nodes[0] : nodes;
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}
