import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
const bundledSnapshot = path.join(dir, "test", "tool", "fixtures", "models-api.json")

async function loadModelsData() {
  if (process.env.MODELS_DEV_API_JSON) {
    return await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  }
  try {
    return await fetch(`${modelsUrl}/api.json`).then((x) => {
      if (!x.ok) throw new Error(`${x.status} ${x.statusText}`)
      return x.text()
    })
  } catch (err) {
    console.warn(`Failed to fetch ${modelsUrl}/api.json (${String(err)}), using local snapshot`)
    return await Bun.file(bundledSnapshot).text()
  }
}

export const modelsData = await loadModelsData()
console.log("Loaded models.dev snapshot")
