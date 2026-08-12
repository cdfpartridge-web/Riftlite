import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [sourceArgument, outputArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) {
  throw new Error("Usage: node scripts/build-mulligan-card-registry.mjs <riftbound_card_registry.json> <output.json>");
}

const sourcePath = resolve(sourceArgument);
const outputPath = resolve(outputArgument);
const source = JSON.parse(await readFile(sourcePath, "utf8"));
if (!Array.isArray(source.cards) || source.schemaVersion !== 1) {
  throw new Error("Source is not a RiftLite packaged card registry v1.");
}

const cards = Object.fromEntries(source.cards.map((card) => {
  if (
    typeof card.printId !== "string" ||
    typeof card.basePrintId !== "string" ||
    typeof card.name !== "string" ||
    typeof card.type !== "string"
  ) throw new Error("Source registry contains an invalid card.");
  return [card.printId, { basePrintId: card.basePrintId, name: card.name, type: card.type }];
}).sort(([left], [right]) => left.localeCompare(right)));

if (Object.keys(cards).length !== source.cards.length) {
  throw new Error("Source registry contains duplicate print ids.");
}

await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: source.generatedAt,
  sourceRegistryPrints: source.cards.length,
  cards,
}, null, 2)}\n`, "utf8");
console.log(`Wrote ${Object.keys(cards).length} exact card identities to ${outputPath}.`);
