export function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 50;
}

export function isNodeInside(node: Node, root: HTMLElement): boolean {
  return node === root || root.contains(node);
}

export function getNodeIndex(node: Node): number {
  return node.parentNode ? Array.prototype.indexOf.call(node.parentNode.childNodes, node) : 0;
}
