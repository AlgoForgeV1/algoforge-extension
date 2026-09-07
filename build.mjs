import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const isWatch = process.argv.includes("--watch");

async function prepareDist() {
  await rm("dist", {
    recursive: true,
    force: true
  });

  await mkdir("dist", {
    recursive: true
  });

  await mkdir("dist/background", {
    recursive: true
  });

  await mkdir("dist/content", {
    recursive: true
  });

  await mkdir("dist/popup", {
    recursive: true
  });

  await mkdir("dist/images", {
    recursive: true
  });

  await cp(
    "manifest.json",
    "dist/manifest.json"
  );

  await cp(
    "src/popup/popup.html",
    "dist/popup/popup.html"
  );

  await cp(
    "src/popup/popup.css",
    "dist/popup/popup.css"
  );

  await cp(
    "src/content/content.css",
    "dist/content/content.css"
  );

  await cp(
    "public/images/forgey.png",
    "dist/images/forgey.png"
  );
}

async function buildExtension() {
  await prepareDist();

  const options = {
    entryPoints: {
      "background/background": "src/background/background.ts",
      "content/content": "src/content/content.ts",
      "popup/popup": "src/popup/popup.ts"
    },
    outdir: "dist",
    bundle: true,
    format: "iife",
    target: "chrome120",
    sourcemap: true,
    minify: false,
    logLevel: "info"
  };

  if (isWatch) {
    const ctx = await context(options);

    await ctx.watch();

    console.log(
      "AlgoForge extension watching for changes..."
    );

    return;
  }

  await build(options);

  console.log(
    "AlgoForge extension built successfully."
  );
}

buildExtension().catch((error) => {
  console.error(error);
  process.exit(1);
});