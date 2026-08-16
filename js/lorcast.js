/** Lorcast API client. The only code in the project that touches the network. */

export const API_BASE = "https://api.lorcast.com/v0";

export class LorcastError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LorcastError";
  }
}

async function getJson(path, fetchImpl) {
  const url = `${API_BASE}${path}`;
  let response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new LorcastError(`Could not reach ${url}. Check your connection.`, { cause });
  }
  if (!response.ok) {
    throw new LorcastError(`${url} returned ${response.status}.`);
  }
  return response.json();
}

/** Every set Lorcast knows about, in the order it returns them. */
export async function fetchSets(fetchImpl = fetch) {
  const payload = await getJson("/sets", fetchImpl);
  return (payload.results ?? []).map((set) => ({
    code: set.code,
    name: set.name,
    releasedAt: set.released_at ?? "",
  }));
}

/** Every card in one set, reduced to the fields this tool uses. */
export async function fetchSetCards(code, fetchImpl = fetch) {
  const payload = await getJson(`/sets/${code}/cards`, fetchImpl);
  return (payload ?? []).map((card) => ({
    collectorNumber: card.collector_number,
    name: card.name,
    version: card.version ?? "",
    rarity: card.rarity,
  }));
}
