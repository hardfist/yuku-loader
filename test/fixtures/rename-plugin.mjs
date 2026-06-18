export default function renamePlugin(api, options = {}) {
  const from = options.from ?? "answer";
  const to = options.to ?? "result";

  return api.visitor({
    Identifier(node) {
      if (node.name === from) {
        node.name = to;
      }
    }
  });
}
