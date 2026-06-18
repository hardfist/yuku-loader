export default function replaceDebugPlugin(api) {
  return api.visitor({
    Identifier(node) {
      if (node.name === "__buildTarget") {
        node.name = "target";
      }
    }
  });
}
