#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function jstNowParts(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: jst.getUTCFullYear(),
    m: pad2(jst.getUTCMonth() + 1),
    d: pad2(jst.getUTCDate()),
    hh: pad2(jst.getUTCHours()),
    mm: pad2(jst.getUTCMinutes()),
  };
}

function getGitShortSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return "nogit";
  }
}

function buildIdNowJst() {
  const p = jstNowParts();
  return `${p.y}${p.m}${p.d}-${p.hh}${p.mm}-${getGitShortSha()}`;
}

function main() {
  const buildId = buildIdNowJst();
  const outPath = path.resolve(__dirname, "../liff/js/buildId.js");
  const content = `export const BUILD_ID = "${buildId}";\n`;
  fs.writeFileSync(outPath, content, "utf8");
  console.log(`Generated BUILD_ID: ${buildId}`);
  console.log(`Wrote: ${outPath}`);
}

main();

