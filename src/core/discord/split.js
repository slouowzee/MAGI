const LIMIT = 1800;

export function splitMessage(text) {
  const parts = [];
  let rest = text;
  while (rest.length > LIMIT) {
    let cut = rest.lastIndexOf('\n', LIMIT);
    if (cut < LIMIT / 2) cut = rest.lastIndexOf(' ', LIMIT);
    if (cut < LIMIT / 2) cut = LIMIT;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}
