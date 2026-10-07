import fs from "node:fs/promises";
import path from "node:path";

// Matches live in MongoDB when MONGODB_URI is set, otherwise in a JSON file.
export async function createStore() {
  if (process.env.MONGODB_URI) {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const cases = client.db(process.env.MONGODB_DB || "gully_umpire").collection("matches");
    await cases.createIndex({ id: 1 }, { unique: true });
    return {
      kind: "MongoDB",
      get: (id) => cases.findOne({ id }, { projection: { _id: 0 } }),
      put: (c) => cases.replaceOne({ id: c.id }, c, { upsert: true }),
    };
  }

  const dir = process.env.DATA_DIR
    ? path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR)
    : path.join(process.cwd(), "data");
  const file = path.join(dir, "matches.json");
  let cases = {};
  try {
    cases = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {}

  let writing = Promise.resolve();
  const flush = () =>
    (writing = writing
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.tmp`, JSON.stringify(cases));
        await fs.rename(`${file}.tmp`, file);
      })
      .catch((err) => console.error("could not save matches:", err.message)));

  return {
    kind: "file",
    get: async (id) => (cases[id] ? structuredClone(cases[id]) : null),
    put: async (c) => {
      cases[c.id] = structuredClone(c);
      await flush();
    },
  };
}
