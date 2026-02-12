#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config({ path: '.env.richmenu' });

const fs = require("node:fs");
const path = require("node:path");

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.LIFF_ID;
const RICHMENU_IMAGE_PATH = process.env.RICHMENU_IMAGE_PATH;
const YARUYO_BUILD_ID = process.env.YARUYO_BUILD_ID;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
}

function contentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error("RICHMENU_IMAGE_PATH must be .png or .jpg/.jpeg");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildIdNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}${m}${day}-${hh}${mm}${ss}`;
}

function buildLiffUrl(view, buildId) {
  const url = new URL(`https://liff.line.me/${LIFF_ID}`);
  url.searchParams.set("view", view);
  url.searchParams.set("v", buildId);
  return url.toString();
}

async function lineApi(pathname, init = {}, baseUrl = "https://api.line.me") {
  const res = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("LINE API error", {
      status: res.status,
      pathname,
      body,
    });
    throw new Error(`LINE API failed ${res.status} ${pathname}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  requireEnv("LINE_CHANNEL_ACCESS_TOKEN", LINE_CHANNEL_ACCESS_TOKEN);
  requireEnv("LIFF_ID", LIFF_ID);
  requireEnv("RICHMENU_IMAGE_PATH", RICHMENU_IMAGE_PATH);
  if (!fs.existsSync(RICHMENU_IMAGE_PATH)) {
    throw new Error(`Image file not found: ${RICHMENU_IMAGE_PATH}`);
  }
  const buildId = YARUYO_BUILD_ID || buildIdNow();
  console.log(`Using build id: ${buildId}`);

  const richMenuRequest = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "YARUYO default",
    chatBarText: "メニュー",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 833, height: 843 },
        action: { type: "uri", uri: buildLiffUrl("declare", buildId) },
      },
      {
        bounds: { x: 833, y: 0, width: 833, height: 843 },
        action: { type: "uri", uri: buildLiffUrl("record", buildId) },
      },
      {
        bounds: { x: 1666, y: 0, width: 834, height: 843 },
        action: { type: "uri", uri: buildLiffUrl("stats", buildId) },
      },
    ],
  };

  const createRes = await lineApi("/v2/bot/richmenu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(richMenuRequest),
  });
  const richMenuId = createRes.richMenuId;
  if (!richMenuId) {
    throw new Error("Failed to create rich menu (richMenuId missing).");
  }
  console.log(`Created rich menu: ${richMenuId}`);

  const imageBytes = fs.readFileSync(RICHMENU_IMAGE_PATH);
  await lineApi(`/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": contentTypeFromPath(RICHMENU_IMAGE_PATH) },
    body: imageBytes,
  }, "https://api-data.line.me");
  console.log(`Uploaded image: ${RICHMENU_IMAGE_PATH}`);

  await lineApi(`/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  console.log(`Set default rich menu: ${richMenuId}`);
  console.log(`richMenuId=${richMenuId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
