import { parseDocument, isMap, isSeq } from 'yaml';

// Upgrade only recognized artifact handshake actions; preserve unknown YAML fields/comments.
export function upgradeStorageSpec(source) {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error('Spec YAML must parse before migration');
  let changes = 0, counter = 0;
  const states = new Set();
  function names(node) { if (isMap(node)) { const s = node.get('save_state'); if (typeof s === 'string') states.add(s); for (const pair of node.items) names(pair.value); } else if (isSeq(node)) node.items.forEach(names); }
  names(doc.contents);
  function set(node, key, value) { if (node.get(key) !== value) { node.set(key, value); changes++; } }
  function walk(node) {
    if (isSeq(node)) {
      // First propagate the original upload MIME type into URL issuance.
      for (const item of node.items) if (isMap(item) && item.get('type') === 'send_http_request' && String(item.get('url')).endsWith('/api/requests/artifacts/upload-url')) {
        const alias = item.get('save_state'); const body = item.get('body', true);
        if (typeof alias !== 'string' || !isMap(body) || body.has('contentType')) continue;
        const upload = node.items.find(a => isMap(a) && a.get('url') === `{actions[${alias}][body][uploadUrl]}`);
        const header = upload?.get('header', true);
        if (isMap(header)) { const type = header.get('Content-Type') ?? header.get('content-type'); if (typeof type === 'string') set(body, 'contentType', type); }
      }
      for (let i = 0; i < node.items.length; i++) {
        const item = node.items[i];
        if (isMap(item) && item.get('type') === 'send_http_request') {
          const url = item.get('url');
          const put = typeof url === 'string' && /^\{actions\[([^\]]+)\]\[body\]\[uploadUrl\]\}$/.exec(url);
          if (put && item.has('body_file')) { set(item, 'method', `{actions[${put[1]}][body][method]}`); set(item, 'header', `{actions[${put[1]}][body][headers]}`); }
          if (typeof url === 'string' && url.endsWith('/api/requests/artifacts/complete')) { const body = item.get('body', true); if (isMap(body) && body.has('storageId')) { body.delete('storageId'); changes++; } }
          if (typeof url === 'string' && url.includes('/api/requests/artifacts/download?') && item.has('response_file')) {
            let state; do { state = `__mu_download_${++counter}`; } while (states.has(state)); states.add(state);
            const issue = doc.createNode({ type: 'send_http_request', url: url.replace('/artifacts/download?', '/artifacts/download-url?'), save_state: state });
            const headers = item.get('header', true); if (headers) issue.set('header', headers.clone());
            if (item.has('timeout')) issue.set('timeout', item.get('timeout'));
            node.items.splice(i, 0, issue); i++;
            item.set('url', `{actions[${state}][body][url]}`); item.set('method', 'get'); item.delete('header'); changes++;
          }
        }
        walk(item);
      }
    } else if (isMap(node)) for (const pair of node.items) walk(pair.value);
  }
  walk(doc.contents);
  return { changes, yaml: changes ? String(doc) : source };
}
