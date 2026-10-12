// A small XML reader, enough for DASH manifests. It exists so the manifest
// parser is pure and runs under Node, which has no DOMParser. It handles
// elements, attributes, text, comments, CDATA and the predefined entities.
// Namespace prefixes are dropped: <cenc:pssh> is read as "pssh".

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== "#") return ENTITIES[body.toLowerCase()] ?? whole;
    const code = body[1]!.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

const local = (name: string): string => name.slice(name.indexOf(":") + 1);

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;

  for (let match = token.exec(source); match; match = token.exec(source)) {
    const top = stack[stack.length - 1]!;
    const [, cdata, closing, opening, attrText, selfClosing, text] = match;
    if (cdata !== undefined) {
      top.text += cdata;
    } else if (closing !== undefined) {
      if (stack.length > 1) stack.pop();
    } else if (opening !== undefined) {
      const node: XmlNode = { name: local(opening), attrs: {}, children: [], text: "" };
      const attr = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      for (let pair = attr.exec(attrText ?? ""); pair; pair = attr.exec(attrText ?? "")) {
        node.attrs[local(pair[1]!)] = decode(pair[2] ?? pair[3] ?? "");
      }
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (text !== undefined) {
      top.text += decode(text);
    }
  }
  return root;
}

export const childrenOf = (node: XmlNode, name: string): XmlNode[] => node.children.filter((child) => child.name === name);
export const childOf = (node: XmlNode, name: string): XmlNode | undefined => node.children.find((child) => child.name === name);
