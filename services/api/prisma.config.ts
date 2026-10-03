import path from "node:path";

import { fileURLToPath } from "node:url";
import {config as loadEnv} from "dotenv";
import {defineConfig} from "prisma/config"

const configDir = path.dirname(fileURLToPath(import.meta.url));

loadEnv({
    path: [path.resolve(configDir, ".env"), path.resolve(configDir, "../../docker/.env")],
    quiet: true,
})

export default defineConfig({
    schema: path.resolve(configDir, "prisma/schema.prisma"),
    migrations: {
        path: path.resolve(configDir, "prisma/migrations"),
        seed: "node prisma/seed.ts"
    },

    datasource: {
        url: process.env.DATABASE_URL ?? "",
    }
})