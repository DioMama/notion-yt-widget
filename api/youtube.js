// Vercel Serverless Function (Node 18+)
// URL: /api/youtube?channel=@TodayDio
// Env: YOUTUBE_API_KEY

function json(res, status, body, cacheSeconds = 21600) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", `public, s-maxage=${cacheSeconds}, stale-while-revalidate=60`);
  res.end(JSON.stringify(body));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  const t = await r.text();
  let data = {};
  try { data = JSON.parse(t); } catch {}
  return { ok: r.ok, status: r.status, statusText: r.statusText, data };
}

async function resolveChannelId({ apiKey, channel }) {
  // channel can be: "@handle", "handle", or "UCxxxx"
  const raw = channel.trim();
  const handle = raw.startsWith("@") ? raw.slice(1) : raw;

  // If UC... treat as channelId
  if (raw.startsWith("UC") && raw.length > 10) return raw;

  // 1) Try channels.list with forHandle (works for many handles)
  {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchJson(url);
    const id = r?.data?.items?.[0]?.id;
    if (r.ok && id) return id;
  }

  // 2) Fallback: search.list -> channelId
  {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(handle)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchJson(url);
    const id = r?.data?.items?.[0]?.snippet?.channelId;
    if (r.ok && id) return id;
  }

  return "";
}

module.exports = async (req, res) => {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, error: "Missing YOUTUBE_API_KEY on server." });

  const url = new URL(req.url, "https://example.com");
  const channel = (url.searchParams.get("channel") || "").trim();
  if (!channel) return json(res, 400, { ok: false, error: "Missing ?channel=" });

  const refresh = Number(url.searchParams.get("refresh") || "21600");
  const cacheSeconds = Number.isFinite(refresh) && refresh >= 60 ? Math.min(refresh, 86400) : 21600;

  try {
    const channelId = await resolveChannelId({ apiKey, channel });
    if (!channelId) return json(res, 404, { ok: false, error: "Could not resolve channelId from channel/handle." }, cacheSeconds);

    const statsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetchJson(statsUrl);

    if (!r.ok) {
      const msg = r?.data?.error?.message || r.statusText || "YouTube API error";
      return json(res, 502, { ok: false, error: msg }, cacheSeconds);
    }

    const item = r?.data?.items?.[0];
    const sub = item?.statistics?.subscriberCount;
    if (sub == null) return json(res, 404, { ok: false, error: "Subscriber count not available." }, cacheSeconds);

    return json(res, 200, {
      ok: true,
      channel,
      channelId,
      subscriberCount: Number(sub),
      fetchedAt: new Date().toISOString(),
    }, cacheSeconds);

  } catch (e) {
    return json(res, 500, { ok: false, error: e?.message || "Server error" }, cacheSeconds);
  }
};
